import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Message, Thread } from '../../../database/entities';
import {
  CONTEXT_LIMITS,
  ContextSummary,
  foldTopics,
  safeTopics,
  topicEvent,
  topicText,
  TopicState,
} from './topics';

@Injectable()
export class ConversationContextService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async prepare(
    threadId: string,
    revision: number,
  ): Promise<{
    state: TopicState;
    history: { role: 'user' | 'assistant'; content: string }[];
    summary?: string;
    publicContext: { summary: string | null };
  }> {
    const thread = await this.db.getRepository(Thread).findOneByOrFail({ id: threadId });
    const summary = thread.contextSummary;
    const base: TopicState = {
      topics: safeTopics(summary?.topics),
      latest: safeTopics(summary?.latest),
    };
    const qb = this.db
      .getRepository(Message)
      .createQueryBuilder('m')
      .where('m.thread_id = :threadId AND m.status = :status', { threadId, status: 'completed' });
    if (summary?.through) qb.andWhere('m.context_order > :through', { through: summary.through });
    const rows = await qb.orderBy('m.context_order', 'ASC').take(500).getMany();
    const event = (m: Message) =>
      m.role === 'user' ? (m.metadata.contextTopics ?? topicEvent(m.content)) : undefined;
    const state = rows.reduce((s, m) => foldTopics(s, event(m)), base);
    const compact =
      rows.length > CONTEXT_LIMITS.messages ||
      rows.reduce((n, m) => n + m.content.length, 0) > CONTEXT_LIMITS.characters ||
      rows.some((m) => m.contextRevision < revision);
    let recent = rows;
    let nextSummary = summary;
    if (compact) {
      // Keep whole completed user/assistant turns; never carry old-revision raw text forward.
      let cut = Math.max(0, rows.length - CONTEXT_LIMITS.recentMessages);
      const lastOld = rows.reduce((last, m, i) => (m.contextRevision < revision ? i : last), -1);
      cut = Math.max(cut, lastOld + 1);
      while (cut < rows.length && rows[cut].role !== 'user') cut++;
      while (
        cut < rows.length &&
        rows.slice(cut).reduce((n, m) => n + m.content.length, 0) > CONTEXT_LIMITS.recentCharacters
      ) {
        cut++;
        while (cut < rows.length && rows[cut].role !== 'user') cut++;
      }
      const older = rows.slice(0, cut);
      if (older.length) {
        const compacted = older.reduce((s, m) => foldTopics(s, event(m)), base);
        const last = older.at(-1)!;
        nextSummary = {
          version: 1,
          ...compacted,
          through: last.contextOrder,
        } satisfies ContextSummary;
        // Compare-and-set prevents a stale concurrent reader from moving the cursor backwards.
        await this.db
          .createQueryBuilder()
          .update(Thread)
          .set({ contextSummary: nextSummary, updatedAt: () => '"updated_at"' })
          .where('id = :id AND context_summary IS NOT DISTINCT FROM :previous::jsonb', {
            id: threadId,
            previous: summary ? JSON.stringify(summary) : null,
          })
          .execute();
      }
      recent = rows.slice(cut);
    }
    // Legacy conversations are folded in bounded batches rather than loading all text at once.
    if (rows.length === 500) return this.prepare(threadId, revision);
    return {
      state,
      history: recent
        .filter((m) => m.contextRevision === revision)
        .map(({ role, content }) => ({ role, content })),
      summary: nextSummary ? topicText(nextSummary) : undefined,
      publicContext: { summary: nextSummary ? topicText(nextSummary) : null },
    };
  }
}
