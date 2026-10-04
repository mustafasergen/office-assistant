import {
  Inject,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Post,
  Patch,
  Delete,
  Body,
  HttpCode,
} from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common/validation';
import { IdentityGuard, IdentityModule } from '../identity/identity.module';
import { LLMModule } from '../llm/llm.module';
import { KnowledgeService } from './knowledge.service';

const documentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(''),
    content: z.string().trim().min(1).max(20000),
  })
  .strict();

// This case has one shared workspace: all anonymous sessions may manage the library.
@Controller('documents')
@UseGuards(IdentityGuard)
class KnowledgeController {
  constructor(@Inject(KnowledgeService) private readonly knowledge: KnowledgeService) {}
  @Get() list() {
    return this.knowledge.list();
  }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.get(id);
  }
  @Post() create(@Body() body: unknown) {
    return this.knowledge.create(parse(documentSchema, body));
  }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.knowledge.update(
      id,
      parse(documentSchema.extend({ revision: z.number().int().positive() }), body),
    );
  }
  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.knowledge.delete(id);
  }
}
@Module({
  imports: [IdentityModule, LLMModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
