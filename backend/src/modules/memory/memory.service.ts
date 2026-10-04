import { Inject, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Memory, User } from '../../database/entities';
import { ToolOutput } from '../llm/llm.types';

@Injectable()
export class MemoryService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async list(userId: string): Promise<Memory[]> {
    return this.db.getRepository(Memory).find({ where: { userId }, order: { key: 'ASC' } });
  }
  async snapshot(userId: string) {
    return this.db.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .findOneOrFail({ where: { id: userId }, lock: { mode: 'pessimistic_read' } });
      return {
        revision: user.memoryRevision,
        memories: await manager
          .getRepository(Memory)
          .find({ where: { userId }, order: { key: 'ASC' } }),
      };
    });
  }
  async save(
    userId: string,
    sourceMessageId: string,
    key: string,
    value: string,
    expectedRevision?: number,
  ): Promise<ToolOutput> {
    return this.db.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .findOneOrFail({ where: { id: userId }, lock: { mode: 'pessimistic_write' } });
      if (expectedRevision !== undefined && expectedRevision !== user.memoryRevision)
        throw new ConflictException('Hafıza değişti. Mesajını tekrar gönder.');
      const repo = manager.getRepository(Memory);
      const previous = await repo.findOneBy({ userId, key });
      if (previous?.value === value)
        return { kind: 'memory', key, value, status: 'unchanged', revision: user.memoryRevision };
      await repo.upsert({ userId, sourceMessageId, key, value }, ['userId', 'key']);
      await manager.getRepository(User).increment({ id: userId }, 'memoryRevision', 1);
      return {
        kind: 'memory',
        key,
        value,
        status: previous ? 'updated' : 'created',
        revision: user.memoryRevision + 1,
      };
    });
  }
  async delete(userId: string, id: string): Promise<void> {
    await this.db.transaction(async (manager) => {
      await manager
        .getRepository(User)
        .findOneOrFail({ where: { id: userId }, lock: { mode: 'pessimistic_write' } });
      const result = await manager.getRepository(Memory).delete({ id, userId });
      if (!result.affected) throw new NotFoundException('Hafıza kaydı bulunamadı.');
      await manager.getRepository(User).increment({ id: userId }, 'memoryRevision', 1);
    });
  }
}
