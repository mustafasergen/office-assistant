import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LLMModule } from '../llm/llm.module';
import { MemoryModule } from '../memory/memory.module';
import { AgentService } from './agent.service';
import { SaveMemoryTool } from './tools/save-memory.tool';
import { SearchDocsTool } from './tools/search-docs.tool';

@Module({
  imports: [LLMModule, KnowledgeModule, MemoryModule],
  providers: [AgentService, SaveMemoryTool, SearchDocsTool],
  exports: [AgentService],
})
export class AgentModule {}
