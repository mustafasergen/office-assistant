import 'reflect-metadata';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config/config';
import { createDataSource } from '../src/database/database.module';
import { MockLLM } from '../src/modules/llm/providers/mock.provider';
import { KnowledgeService } from '../src/modules/knowledge/knowledge.service';
import { groundedMockMatches, focusedMockAnswer } from '../src/modules/llm/mock-grounding';
import { tokens } from '../src/modules/llm/text';

export const cases = [
  { query: 'Yıllık izin hakkım kaç iş günü?', title: 'İzin politikası', evidence: ['20 iş günü'] },
  {
    query: 'Toplantı odasını nasıl rezerve ederim?',
    title: 'Ofis kuralları',
    evidence: ['şirket takviminden rezerve edilir'],
  },
  {
    query: 'Ofiste telefon görüşmelerini nerede yapabilirim?',
    title: 'Ofis kuralları',
    evidence: ['telefon kabinlerinde veya toplantı odalarında'],
  },
];
async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (
    !url ||
    !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test')
  )
    throw new Error('Explicit local *_test DB required');
  const config = readConfig({
    DATABASE_URL: url,
    LLM_PROVIDER: 'mock',
    DOCUMENTS_DIR: resolve(__dirname, '../../fixtures/documents'),
  });
  const db = createDataSource(config);
  await db.initialize();
  await db.runMigrations();
  try {
    // Isolated fixture diagnostic: other integration suites deliberately edit/delete documents.
    await db.query('TRUNCATE users, documents CASCADE');
    const knowledge = new KnowledgeService(db, new MockLLM(), config);
    await knowledge.ensureIndex();
    const results = [];
    for (const item of cases) {
      const matches = await knowledge.search(item.query);
      const selected = groundedMockMatches(item.query, matches);
      const answer = selected.map((m) => focusedMockAnswer(item.query, m)).join('\n');
      results.push({
        ...item,
        terms: tokens(item.query),
        retrieved: matches.map((m) => ({
          title: m.title,
          score: m.score,
          chunkId: m.chunkId,
          content: m.content,
          uncovered: tokens(item.query).filter((t) => !tokens(m.content).includes(t)),
        })),
        selected: selected.map((m) => m.chunkId),
        answer,
        passed:
          item.evidence.every((e) => answer.includes(e)) &&
          selected.some((m) => m.title === item.title),
      });
    }
    const label = process.env.MANUAL_BASELINE === '1' ? 'before' : 'after';
    await writeFile(
      resolve(__dirname, `../../docs/test-reports/manual-questions-${label}.json`),
      JSON.stringify(
        { config: { threshold: config.SEARCH_MIN_SCORE, topK: config.SEARCH_TOP_K }, results },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        results.map(({ query, passed, retrieved, answer }) => ({
          query,
          passed,
          answer,
          retrieved: retrieved.map(({ title, score, uncovered }) => ({ title, score, uncovered })),
        })),
        null,
        2,
      ),
    );
    if (label === 'after') assert(results.every((r) => r.passed));
  } finally {
    await db.destroy();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
