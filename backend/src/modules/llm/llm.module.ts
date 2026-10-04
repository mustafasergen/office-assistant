import { Module } from '@nestjs/common';
import { type AppConfig, CONFIG } from '../../config/config';
import { LLM_PROVIDER } from './llm.types';
import { MockLLM } from './providers/mock.provider';
import { OpenAIProvider } from './providers/openai.provider';

@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [CONFIG],
      useFactory: (config: AppConfig) =>
        config.LLM_PROVIDER === 'mock' ? new MockLLM() : new OpenAIProvider(config),
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LLMModule {}
