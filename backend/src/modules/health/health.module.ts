import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { type AppConfig, CONFIG } from '../../config/config';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { KnowledgeService } from '../knowledge/knowledge.service';

@Controller('health')
class HealthController {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    if (!this.knowledge.ready) throw new ServiceUnavailableException('Bilgi tabanı hazırlanıyor.');
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('Veritabanına ulaşılamıyor.');
    }
    return { status: 'ok', provider: this.config.LLM_PROVIDER };
  }
}
@Module({ imports: [KnowledgeModule], controllers: [HealthController] })
export class HealthModule {}
