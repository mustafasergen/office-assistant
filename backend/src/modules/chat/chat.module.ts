import { ConversationContextService } from './context/conversation-context.service';
import {
  Inject,
  Delete,
  HttpCode,
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common/validation';
import { AgentModule } from '../agent/agent.module';
import { IdentityGuard, IdentityModule, type UserRequest } from '../identity/identity.module';
import { MemoryModule } from '../memory/memory.module';
import { ChatService } from './chat.service';

const messageSchema = z
  .object({
    content: z
      .string()
      .trim()
      .min(1, 'Mesaj boş olamaz.')
      .refine((text) => /[\p{L}\p{N}]/u.test(text), 'Mesaj anlamlı bir metin içermeli.')
      .max(4000, 'Mesaj en fazla 4000 karakter olabilir.'),
  })
  .strict();
@Controller('threads')
@UseGuards(IdentityGuard)
class ChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}
  @Get() list(@Req() req: UserRequest) {
    return this.chat.list(req.userId);
  }
  @Post() create(@Req() req: UserRequest) {
    return this.chat.create(req.userId);
  }
  @Delete(':id')
  @HttpCode(204)
  async delete(@Req() req: UserRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.chat.delete(req.userId, id);
  }
  @Get(':id/context') context(@Req() req: UserRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.conversationContext(req.userId, id);
  }
  @Get(':id/messages') messages(@Req() req: UserRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.messages(req.userId, id);
  }
  @Post(':id/messages') send(
    @Req() req: UserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.chat.send(req.userId, id, parse(messageSchema, body).content);
  }
}
@Module({
  imports: [IdentityModule, AgentModule, MemoryModule],
  controllers: [ChatController],
  providers: [ChatService, ConversationContextService],
})
export class ChatModule {}
