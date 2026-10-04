import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { ToolOutput } from '../../llm/llm.types';

export const searchArgs = z.object({ query: z.string().trim().min(1).max(4000) }).strict();
@Injectable()
export class SearchDocsTool {
  constructor(@Inject(KnowledgeService) private readonly knowledge: KnowledgeService) {}
  async execute(args: z.infer<typeof searchArgs>, signal: AbortSignal): Promise<ToolOutput> {
    return { kind: 'search', matches: await this.knowledge.search(args.query, signal) };
  }
}
