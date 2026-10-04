import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Memory } from '../../database/entities';
import { ToolOutput } from '../llm/llm.types';

@Injectable()
export class MemoryService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async list(userId: string): Promise<Memory[]> {
    return this.db.getRepository(Memory).find({ where: { userId }, order: { key: 'ASC' } });
  }
  async save(
    userId: string,
    sourceMessageId: string,
    key: string,
    value: string,
  ): Promise<ToolOutput> {
    const repo = this.db.getRepository(Memory);
    const previous = await repo.findOneBy({ userId, key });
    if (previous?.value === value) return { kind: 'memory', key, value, status: 'unchanged' };
    await repo.upsert({ userId, sourceMessageId, key, value }, ['userId', 'key']);
    return { kind: 'memory', key, value, status: previous ? 'updated' : 'created' };
  }
  async delete(userId: string, id: string): Promise<void> {
    const result = await this.db.getRepository(Memory).delete({ id, userId });
    if (!result.affected) throw new NotFoundException('Hafıza kaydı bulunamadı.');
  }
}
