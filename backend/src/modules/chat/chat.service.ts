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
import { Message, Thread } from '../../database/entities';
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
  async send(userId: string, threadId: string, content: string) {
    const thread = await this.owned(userId, threadId);
    if (this.active.has(threadId))
      throw new ConflictException('Bu konuşmada bir yanıt hazırlanıyor.');
    this.active.add(threadId);
    let message: Message | undefined;
    try {
      const repo = this.db.getRepository(Message);
      const history = (
        await repo.find({
          where: { threadId, status: 'completed' },
          order: { createdAt: 'DESC', id: 'DESC' },
          take: 20,
        })
      ).reverse();
      message = await repo.save({
        threadId,
        role: 'user',
        content,
        status: 'processing',
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
      const answer = await this.agent.run({
        userId,
        messageId: message.id,
        currentMessage: content,
        history: history.map(({ role, content }) => ({ role, content })),
        memories: await this.memory.list(userId),
      });
      const assistantMessage = await this.db.transaction(async (manager) => {
        await manager.getRepository(Message).update(message!.id, { status: 'completed' });
        return manager.getRepository(Message).save({
          threadId,
          role: 'assistant',
          content: answer.content,
          status: 'completed',
          metadata: { sources: answer.sources, tools: answer.tools },
        });
      });
      return { userMessage: { ...message, status: 'completed' }, assistantMessage };
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
