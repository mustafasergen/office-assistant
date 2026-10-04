import {
  Inject,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IdentityGuard, IdentityModule, type UserRequest } from '../identity/identity.module';
import { MemoryService } from './memory.service';

@Controller('memories')
@UseGuards(IdentityGuard)
class MemoryController {
  constructor(@Inject(MemoryService) private readonly memory: MemoryService) {}
  @Get() list(@Req() req: UserRequest) {
    return this.memory.list(req.userId);
  }
  @Delete(':id')
  @HttpCode(204)
  async delete(@Req() req: UserRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.memory.delete(req.userId, id);
  }
}
@Module({
  imports: [IdentityModule],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
