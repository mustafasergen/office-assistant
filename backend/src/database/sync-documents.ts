import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readConfig } from '../config/config';
import { createDataSource } from './database.module';
import { KnowledgeService } from '../modules/knowledge/knowledge.service';
import { parseSeedDocument } from '../modules/knowledge/seed-document';
import { MockLLM } from '../modules/llm/providers/mock.provider';
import { OpenAIProvider } from '../modules/llm/providers/openai.provider';

loadEnv({ path: resolve(process.cwd(), '../.env'), quiet: true });

async function main() {
  if (!process.argv.includes('--apply'))
    throw new Error('Pass --apply to replace existing seed documents from fixtures.');
  const config = readConfig();
  const db = createDataSource(config);
  await db.initialize();
  try {
    if (await db.showMigrations()) throw new Error('Run db:migrate first.');
    const provider = config.LLM_PROVIDER === 'openai' ? new OpenAIProvider(config) : new MockLLM();
    const knowledge = new KnowledgeService(db, provider, config);
    await knowledge.ensureIndex();
    const documents = await knowledge.list();
    const files = (await readdir(config.DOCUMENTS_DIR))
      .filter((name) => /\.(md|txt)$/.test(name))
      .sort();
    for (const slug of files) {
      const item = documents.find((document) => document.slug === slug);
      // Explicit deletion in the library still takes precedence over a seed import.
      if (!item) {
        console.log(`Skipped deleted seed: ${slug}`);
        continue;
      }
      const seed = parseSeedDocument(
        await readFile(join(config.DOCUMENTS_DIR, slug), 'utf8'),
        slug,
      );
      const current = await knowledge.get(item.id);
      if (
        current.title === seed.title &&
        current.description === seed.description &&
        current.content === seed.content
      ) {
        console.log(`Unchanged: ${slug}`);
        continue;
      }
      await knowledge.update(item.id, { ...seed, revision: current.revision });
      console.log(`Updated and indexed: ${slug}`);
    }
  } finally {
    await db.destroy();
  }
}
main().catch((error: unknown) => {
  // Provider/database error payloads may contain sensitive connection details.
  const diagnostic = error as { name?: string; code?: string; status?: number };
  console.error(
    JSON.stringify({ name: diagnostic.name, code: diagnostic.code, status: diagnostic.status }),
  );
  process.exitCode = 1;
});
