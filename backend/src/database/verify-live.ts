import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readConfig } from '../config/config';
import { KnowledgeService } from '../modules/knowledge/knowledge.service';
import { OpenAIProvider } from '../modules/llm/providers/openai.provider';
import { createDataSource } from './database.module';
import { parseSeedDocument } from '../modules/knowledge/seed-document';

loadEnv({ path: resolve(process.cwd(), '../.env'), quiet: true });

async function main() {
  const config = readConfig();
  assert.equal(config.LLM_PROVIDER, 'openai', 'This opt-in check requires LLM_PROVIDER=openai');
  const db = createDataSource(config);
  await db.initialize();
  try {
    assert.equal(await db.showMigrations(), false, 'Apply migrations before verification');
    const provider = new OpenAIProvider(config);
    const knowledge = new KnowledgeService(db, provider, config);
    const [vector] = await provider.embed(['Yıllık izin politikası']);
    assert.equal(vector.length, 1536);
    assert(vector.every(Number.isFinite));
    await knowledge.ensureIndex();
    for (const document of await knowledge.list()) {
      if (document.slug.startsWith('custom-')) continue;
      const seed = parseSeedDocument(
        await readFile(resolve(config.DOCUMENTS_DIR, document.slug), 'utf8'),
        document.slug,
      );
      const stored = await knowledge.get(document.id);
      assert.deepEqual(
        { title: stored.title, description: stored.description, content: stored.content },
        seed,
        'Seed differs: run db:sync-documents --apply if overwriting the stored edit is intended',
      );
    }
    for (const [query, title] of [
      ['İzin iptali nasıl yapılır?', 'İzin politikası'],
      ['Gıda alerjisi için ne yapmalıyım?', 'Yemek kartı ve yemek seçenekleri'],
      ['Misafir kabulü nasıl yapılır?', 'Ofis kuralları'],
      ['VPN sorunu nasıl bildirilir?', 'Çalışma düzeni'],
    ]) {
      const results = await knowledge.search(query);
      assert.equal(results[0]?.title, title, `Unexpected top source for: ${query}`);
    }
    const matches = await knowledge.search('Yıllık izin kaç iş günü?');
    assert(matches.length > 0);
    assert(
      matches.some(
        (match) => match.title.toLocaleLowerCase('tr').includes('izin') && /20/.test(match.content),
      ),
    );
    const unrelated = await knowledge.search('Mars gezegeninin çapı kaç kilometre?');
    assert.equal(unrelated.length, 0, 'Unrelated query should not retrieve company policy');
    const before = await db.query('SELECT id FROM document_chunks ORDER BY id');
    await knowledge.ensureIndex();
    assert.deepEqual(await db.query('SELECT id FROM document_chunks ORDER BY id'), before);
    const first = await provider.chat({
      currentMessage: 'Yıllık izin kaç iş günü?',
      history: [],
      memories: [],
      toolResults: [],
    });
    assert.equal(first.kind, 'tool_calls');
    if (first.kind !== 'tool_calls') throw new Error('Missing tool call');
    const call = first.calls.find((item) => item.name === 'search_docs');
    assert(call);
    let final = await provider.chat({
      currentMessage: 'Yıllık izin kaç iş günü?',
      history: [],
      memories: [],
      state: first.state,
      toolResults: [{ call, output: { kind: 'search', matches } }],
    });
    for (let step = 2; final.kind === 'continue' && step < config.AGENT_MAX_STEPS; step++)
      final = await provider.chat({
        currentMessage: 'Yıllık izin kaç iş günü?',
        history: [],
        memories: [],
        state: final.state,
        toolResults: [{ call, output: { kind: 'search', matches } }],
      });
    assert.equal(final.kind, 'final');
    if (final.kind !== 'final') throw new Error('Missing final answer');
    assert.match(final.content, /20/);
    assert(final.citedChunkIds.length > 0);
    assert(final.citedChunkIds.every((id) => matches.some((match) => match.chunkId === id)));
    console.log(
      JSON.stringify(
        {
          database: 'connected with verified TLS',
          embeddingDimensions: vector.length,
          documents: (await knowledge.list()).length,
          chunks: before.length,
          retrieval: matches.map(({ title, score }) => ({ title, score })),
          unrelatedMatches: unrelated.length,
          unchangedSeed: 'passed',
          seedContentAndDescriptions: 'passed',
          expandedTopicRetrieval: '4 passed',
          chatToolContinuation: 'passed',
          citedSources: final.citedChunkIds.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.destroy();
  }
}
main().catch((error: unknown) => {
  // OpenAI errors can include request headers; only print diagnostic identifiers.
  const diagnostic = error as { name?: string; code?: string; status?: number; message?: string };
  console.error(
    JSON.stringify({
      name: diagnostic.name,
      code: diagnostic.code,
      status: diagnostic.status,
      assertion: diagnostic.name === 'AssertionError' ? diagnostic.message : undefined,
    }),
  );
  process.exitCode = 1;
});
