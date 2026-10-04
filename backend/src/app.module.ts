import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config';
import { DatabaseModule } from './database/database.module';
import { ChatModule } from './modules/chat/chat.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { MemoryModule } from './modules/memory/memory.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    IdentityModule,
    KnowledgeModule,
    MemoryModule,
    ChatModule,
    HealthModule,
  ],
})
export class AppModule {}
