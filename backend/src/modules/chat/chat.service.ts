import { ConversationContextService } from './context/conversation-context.service';
import { resolveFollowUp, topicEvent } from './context/topics';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Message, Thread, User } from '../../database/entities';
import { AgentService } from '../agent/agent.service';
import { extractMemoryRetractions } from '../memory/facts';
import { MemoryService } from '../memory/memory.service';

@Injectable()
export class ChatService implements OnApplicationBootstrap {
  private readonly active = new Set<string>();
  private readonly logger = new Logger(ChatService.name);
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(AgentService) private readonly agent: AgentService,
    @Inject(MemoryService) private readonly memory: MemoryService,
    @Inject(ConversationContextService) private readonly context: ConversationContextService,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    // A single backend instance owns runs. Interrupted runs never remain "processing" after restart.
    await this.db.getRepository(Message).update(
      { status: 'processing' },
      {
        status: 'failed',
        metadata: { error: 'Uygulama yeniden başlatıldı. Mesajı tekrar gönderebilirsiniz.' },
      },
    );
  }
  async list(userId: string) {
    return this.db
      .getRepository(Thread)
      .find({ where: { userId }, order: { updatedAt: 'DESC', id: 'ASC' } });
  }
  async create(userId: string) {
    return this.db.getRepository(Thread).save({ userId, title: 'Yeni konuşma' });
  }
  private async owned(userId: string, id: string): Promise<Thread> {
    const thread = await this.db.getRepository(Thread).findOneBy({ id, userId });
    if (!thread) throw new NotFoundException('Konuşma bulunamadı.');
    return thread;
  }
  async delete(userId: string, id: string): Promise<void> {
    await this.owned(userId, id);
    if (this.active.has(id)) throw new ConflictException('Bu konuşmada yanıt hazırlanıyor.');
    this.active.add(id);
    try {
      await this.db.getRepository(Thread).delete({ id, userId });
    } finally {
      this.active.delete(id);
    }
  }
  async messages(userId: string, threadId: string) {
    await this.owned(userId, threadId);
    return this.db
      .getRepository(Message)
      .find({ where: { threadId }, order: { createdAt: 'ASC', id: 'ASC' } });
  }
  async conversationContext(userId: string, threadId: string) {
    await this.owned(userId, threadId);
    return (await this.context.prepare(threadId, (await this.memory.snapshot(userId)).revision))
      .publicContext;
  }
  async send(userId: string, threadId: string, content: string) {
    const thread = await this.owned(userId, threadId);
    if (this.active.has(threadId))
      throw new ConflictException('Bu konuşmada bir yanıt hazırlanıyor.');
    this.active.add(threadId);
    let message: Message | undefined;
    try {
      const repo = this.db.getRepository(Message);
      const initial = await this.memory.snapshot(userId);
      message = await repo.save({
        threadId,
        role: 'user',
        content,
        status: 'processing',
        contextRevision: initial.revision,
        metadata: {},
      });
      await this.db.getRepository(Thread).update(threadId, {
        updatedAt: new Date(),
        ...(thread.title === 'Yeni konuşma' ? { title: content.slice(0, 70) } : {}),
      });
      const retracted = extractMemoryRetractions(content);
      for (const fact of await this.memory.list(userId)) {
        if (fact.key === 'dietary_preference' && retracted.includes(fact.value))
          await this.memory.delete(userId, fact.id);
      }
      const snapshot = await this.memory.snapshot(userId);
      const context = await this.context.prepare(threadId, snapshot.revision);
      const resolved = resolveFollowUp(content, context.state);
      const answer = resolved.clarification
        ? {
            content: resolved.clarification,
            sources: [],
            tools: [],
            contextRevision: snapshot.revision,
          }
        : await this.agent.run({
            userId,
            messageId: message.id,
            currentMessage: content,
            query: resolved.query,
            history: context.history,
            summary: context.summary,
            memories: snapshot.memories,
            contextRevision: snapshot.revision,
            refreshContext: async () => {
              const fresh = await this.memory.snapshot(userId);
              const prepared = await this.context.prepare(threadId, fresh.revision);
              return { ...fresh, history: prepared.history, summary: prepared.summary };
            },
          });
      const assistantMessage = await this.db.transaction(async (manager) => {
        const user = await manager
          .getRepository(User)
          .findOneOrFail({ where: { id: userId }, lock: { mode: 'pessimistic_read' } });
        if (user.memoryRevision !== answer.contextRevision)
          throw new ConflictException('Hafıza değişti. Mesajını tekrar gönder.');
        await manager.getRepository(Message).update(message!.id, {
          status: 'completed',
          metadata: { contextTopics: topicEvent(resolved.query) },
        });
        return manager.getRepository(Message).save({
          threadId,
          role: 'assistant',
          contextRevision: initial.revision,
          content: answer.content,
          status: 'completed',
          metadata: { sources: answer.sources, tools: answer.tools },
        });
      });
      // Summarization is derived state: a failure after the answer commits must not fail the chat.
      let publicContext = context.publicContext;
      try {
        publicContext = (
          await this.context.prepare(threadId, (await this.memory.snapshot(userId)).revision)
        ).publicContext;
      } catch {
        this.logger.warn('Konuşma özeti sonraki istekte yeniden hazırlanacak.');
      }
      return {
        userMessage: { ...message, status: 'completed' },
        assistantMessage,
        context: publicContext,
      };
    } catch (error) {
      const publicError =
        error instanceof HttpException
          ? error.message
          : 'Asistan şu anda yanıt veremiyor. Lütfen tekrar deneyin.';
      if (message)
        await this.db
          .getRepository(Message)
          .update(message.id, { status: 'failed', metadata: { error: publicError } });
      // No prompts, cookie values, or provider secrets in application logs.
      this.logger.warn(
        `Çalıştırma başarısız: ${error instanceof Error ? error.name : 'UnknownError'}`,
      );
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(publicError);
    } finally {
      this.active.delete(threadId);
    }
  }
}
