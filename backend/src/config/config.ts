import { Global, Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { z } from 'zod';
import { APP_DEFAULTS, SEARCH_MIN_SCORES, SEARCH_TOP_K_BY_PROVIDER } from './defaults';

const schema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().default('postgresql://uplico:uplico@localhost:5432/uplico'),
    ),
    COOKIE_SECRET: z
      .string()
      .min(24)
      .default('uplico-local-demo-cookie-secret-change-for-deployment'),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    LLM_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
    OPENAI_API_KEY: z.string().optional(),
    DOCUMENTS_DIR: z.string().default(resolve(process.cwd(), '../fixtures/documents')),
  })
  .superRefine((config, ctx) => {
    if (config.LLM_PROVIDER === 'openai') {
      for (const key of ['OPENAI_API_KEY'] as const) {
        if (!config[key]?.trim())
          ctx.addIssue({ code: 'custom', path: [key], message: 'OpenAI modunda zorunlu.' });
      }
    }
  });

export type AppConfig = z.infer<typeof schema> & typeof APP_DEFAULTS & { SEARCH_MIN_SCORE: number };
export const CONFIG = Symbol('CONFIG');
export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Geçersiz config: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  return {
    ...result.data,
    ...APP_DEFAULTS,
    SEARCH_MIN_SCORE: SEARCH_MIN_SCORES[result.data.LLM_PROVIDER],
    SEARCH_TOP_K: SEARCH_TOP_K_BY_PROVIDER[result.data.LLM_PROVIDER],
  };
}

@Global()
@Module({ providers: [{ provide: CONFIG, useFactory: readConfig }], exports: [CONFIG] })
export class ConfigModule {}
