/* eslint-disable @typescript-eslint/no-explicit-any -- heterogeneous product-case assertions are serialized in the report. */
import 'reflect-metadata';
import { resolve } from 'node:path';
import OpenAI from 'openai';
import { readConfig } from '../../src/config/config';
import { DocumentChunk, Memory, Message, User } from '../../src/database/entities';
import { KnowledgeService, validateEmbedding } from '../../src/modules/knowledge/knowledge.service';
import { chunkDocument } from '../../src/modules/knowledge/chunking';
import { MockLLM } from '../../src/modules/llm/providers/mock.provider';
import { OpenAIProvider } from '../../src/modules/llm/providers/openai.provider';
import { LLMProvider, ChatInput } from '../../src/modules/llm/llm.types';
import { extractMemoryFacts } from '../../src/modules/memory/facts';
import { MemoryService } from '../../src/modules/memory/memory.service';
import { AgentService } from '../../src/modules/agent/agent.service';
import { SearchDocsTool } from '../../src/modules/agent/tools/search-docs.tool';
import { SaveMemoryTool } from '../../src/modules/agent/tools/save-memory.tool';
import { ChatService } from '../../src/modules/chat/chat.service';
import { dailyBehaviorChecks } from './stateful';
import { supportsAnswer } from './answer-oracle';
import { queries, memoryCases } from './corpus';
import { Result, saveReport, meteredClient } from './support';
import { testDatabase, remoteTestDatabase } from './db';

async function main() {
  const live = process.env.EVAL_LIVE === '1';
  const label = process.env.EVAL_LABEL ?? 'baseline';
  const remote = live ? await remoteTestDatabase() : null;
  const db = remote?.db ?? (await testDatabase());
  const config = readConfig({
    ...process.env,
    LLM_PROVIDER: live ? 'openai' : 'mock',
    DOCUMENTS_DIR: resolve(__dirname, '../../../fixtures/documents'),
  });
  const llm: LLMProvider = live ? new OpenAIProvider(config, await meteredClient()) : new MockLLM();
  let providerError: string | undefined;
  const providerChat = llm.chat.bind(llm);
  llm.chat = async (input) => {
    providerError = undefined;
    try {
      return await providerChat(input);
    } catch (error) {
      providerError = error instanceof Error ? error.message : 'provider error';
      throw error;
    }
  };
  const knowledge = new KnowledgeService(db, llm, config);
  const memory = new MemoryService(db);
  const agent = new AgentService(
    llm,
    new SearchDocsTool(knowledge),
    new SaveMemoryTool(memory),
    config,
  );
  const chat = new ChatService(db, agent, memory);
  const rows: Result[] = [];
  const env = live ? 'OpenAI live + Supabase isolated schema' : 'Mock + isolated PostgreSQL';
  const check = async (
    group: string,
    input: unknown,
    expected: unknown,
    run: () => Promise<unknown> | unknown,
    verify: (actual: any) => boolean,
  ) => {
    let actual: unknown;
    let pass = false;
    try {
      actual = await run();
      pass = verify(actual);
    } catch (e) {
      actual = { error: e instanceof Error ? e.message : 'unknown', providerError };
    }
    rows.push({
      group,
      input,
      expected,
      actual,
      pass,
      environment: group === '25' ? 'OpenAI adapter / fake SDK (no live API)' : env,
    });
    if (live && rows.length % 10 === 0)
      console.log(
        JSON.stringify({ completed: rows.length, failed: rows.filter((row) => !row.pass).length }),
      );
  };
  const throws = async (fn: () => Promise<unknown> | unknown) => {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  };
  try {
    await knowledge.ensureIndex();
    const user = await db.getRepository(User).save({});
    const raw = new KnowledgeService(db, llm, {
      ...config,
      SEARCH_MIN_SCORE: -1,
      SEARCH_TOP_K: 30,
    });
    const scores = [];
    for (const q of queries.filter(
      (item) => !process.env.EVAL_ONLY || new RegExp(process.env.EVAL_ONLY).test(item.query),
    )) {
      const ranked = await raw.search(q.query);
      scores.push({
        ...q,
        ranked: ranked.map((m) => ({ content: m.content, title: m.title, score: m.score })),
      });
      await check(
        q.group,
        q.query,
        q.evidence.length
          ? { answerEvidence: q.evidence, sources: 'support each answer' }
          : { answer: 'unknown', sources: [] },
        async () => {
          const thread = await chat.create(user.id);
          const reply = await chat.send(user.id, thread.id, q.query);
          return reply.assistantMessage;
        },
        (m: Message) =>
          q.evidence.length
            ? q.evidence.every(
                (e) =>
                  supportsAnswer(m.content, e) &&
                  m.metadata.sources?.some((s) => s.excerpt.includes(e)),
              )
            : !m.metadata.sources?.length &&
              /bulamad|bulunm|bilgi.*yok|belirtilm|yer alm|bilmi|bilmiyorum/i.test(m.content),
      );
    }
    if (!live) {
      for (const item of memoryCases)
        await check(
          item.group,
          item.text,
          item.expected,
          () => extractMemoryFacts(item.text),
          (actual) => JSON.stringify(actual) === JSON.stringify(item.expected),
        );
      for (const text of ['', '   ', '?!...', '\u200b\u200b'])
        await check(
          '09',
          text,
          [],
          () => knowledge.search(text),
          (r) => r.length === 0,
        );
      const long = Array.from({ length: 480 }, (_, i) => `kelime${i}`).join(' ');
      await check(
        '10',
        '480-word paragraph',
        'all words retained',
        () => chunkDocument(long),
        (parts) =>
          Array.from({ length: 480 }, (_, i) => `kelime${i}`).every((word) =>
            parts.some((p: string) => p.split(/\s+/).includes(word)),
          ),
      );
      await check(
        '11',
        '199-word filler + unique boundary answer',
        'question/answer not separated',
        () =>
          chunkDocument(
            '## Protokol\n\n' +
              'dolgu '.repeat(194) +
              'Atlas anahtarı KOBALT rengindedir. ' +
              'devam '.repeat(40),
          ),
        (parts) => parts.some((p: string) => p.includes('Atlas anahtarı KOBALT rengindedir.')),
      );
      await check(
        '12',
        '# Avrupa\n## İzin\n### Süre\n28 gün.',
        'parent headings retained',
        () => chunkDocument('# Avrupa\n\n## İzin\n\n### Süre\n\n28 gün.'),
        (parts) =>
          parts.some(
            (p: string) => p.includes('Avrupa') && p.includes('İzin') && p.includes('28 gün'),
          ),
      );
      const docs = [];
      for (let i = 0; i < 5; i++)
        docs.push(
          await knowledge.create({
            title: 'Eşit belge',
            description: '',
            content: 'Zümrüt pusula kontrol metni.',
          }),
        );
      await check(
        '13',
        'five equal vectors / topK=3',
        'exactly 3 stable ties',
        async () => {
          const a = await knowledge.search('Zümrüt pusula');
          const b = await knowledge.search('Zümrüt pusula');
          return { a: a.map((x) => x.chunkId), b: b.map((x) => x.chunkId) };
        },
        (r) => r.a.length === 3 && JSON.stringify(r.a) === JSON.stringify(r.b),
      );
      for (const d of docs) await knowledge.delete(d.id);
      await check(
        '14',
        'same input twice',
        '1536 finite normalized deterministic',
        async () => {
          const [a, b] = await llm.embed(['İzin hakkı', 'İzin hakkı']);
          return {
            dim: a.length,
            norm: Math.hypot(...a),
            equal: JSON.stringify(a) === JSON.stringify(b),
            finite: a.every(Number.isFinite),
          };
        },
        (r) => r.dim === 1536 && Math.abs(r.norm - 1) < 1e-8 && r.equal && r.finite,
      );
      for (const vector of [
        [],
        [1],
        Array(1536).fill(0),
        Array(1536).fill(NaN),
        Array(1536).fill(Infinity),
      ])
        await check(
          '15',
          { length: vector.length, first: String(vector[0]) },
          'reject',
          () => throws(() => validateEmbedding(vector)),
          Boolean,
        );
      const t = await chat.create(user.id);
      await chat.send(user.id, t.id, 'Veganım.');
      await chat.send(user.id, t.id, 'Vejetaryenim.');
      await check(
        '16',
        'Veganım → Vejetaryenim',
        'one updated dietary record',
        () => memory.list(user.id),
        (r) =>
          r.filter((m: Memory) => m.key === 'dietary_preference').length === 1 &&
          r.find((m: Memory) => m.key === 'dietary_preference').value === 'vegetarian',
      );
      for (const m of await memory.list(user.id)) await memory.delete(user.id, m.id);
      await check(
        '17',
        'delete preference; new thread asks food',
        'no remembered preference, no resurrection',
        async () => {
          const fresh = await chat.create(user.id);
          const result = await chat.send(user.id, fresh.id, 'Yemek seçenekleri neler?');
          return { answer: result.assistantMessage.content, memories: await memory.list(user.id) };
        },
        (r) => !r.answer.includes('tercihini') && r.memories.length === 0,
      );
      const doc = await knowledge.create({
        title: 'Kobalt erişim',
        description: 'özel kayıt',
        content: 'Kobalt erişim kodu MAVİ olarak belirlenmiştir.',
      });
      await knowledge.update(doc.id, {
        title: doc.title,
        description: '',
        content: 'Kobalt erişim kodu YEŞİL olarak değiştirilmiştir.',
        revision: doc.revision,
      });
      await check(
        '20',
        'create MAVİ → edit YEŞİL',
        'new source only',
        () => knowledge.search('Kobalt erişim kodu'),
        (r) => r[0]?.content.includes('YEŞİL') && !r.some((m: any) => m.content.includes('MAVİ')),
      );
      await knowledge.delete(doc.id);
      await check(
        '20',
        'delete Kobalt document',
        'no deleted chunks',
        () => db.getRepository(DocumentChunk).countBy({ documentId: doc.id }),
        (r) => r === 0,
      );
      const other: LLMProvider = {
        embeddingKey: 'evaluation:other',
        embed: (t, s) => llm.embed(t, s),
        chat: (i) => llm.chat(i),
      };
      await new KnowledgeService(db, other, config).ensureIndex();
      await check(
        '21',
        'switch embedding key',
        'old provider cannot read other space',
        () => knowledge.search('Yıllık izin'),
        (r) => r.length === 0,
      );
      await knowledge.ensureIndex();
      const base: ChatInput = {
        currentMessage: 'Yıllık izin kaç gün?',
        history: [],
        memories: [],
        toolResults: [],
      };
      const context = {
        ...base,
        userId: user.id,
        messageId: '00000000-0000-0000-0000-000000000000',
      };
      let calls = 0;
      const loop: LLMProvider = {
        ...other,
        chat: async (input) => {
          calls++;
          return input.toolResults.length
            ? {
                kind: 'final',
                content: '20 iş günü',
                citedChunkIds:
                  input.toolResults[0].output.kind === 'search'
                    ? [input.toolResults[0].output.matches[0].chunkId]
                    : [],
              }
            : {
                kind: 'tool_calls',
                calls: [
                  { id: 'c1', name: 'search_docs', arguments: { query: 'Yıllık izin kaç gün?' } },
                ],
              };
        },
      };
      await check(
        '22',
        'tool → model → answer',
        '2 model calls, verified citation',
        async () => {
          const answer = await new AgentService(
            loop,
            new SearchDocsTool(knowledge),
            new SaveMemoryTool(memory),
            config,
          ).run(context);
          return { calls, sources: answer.sources.length };
        },
        (r) => r.calls === 2 && r.sources > 0,
      );
      await check(
        '22',
        'invented source',
        'rejected',
        () =>
          throws(() =>
            new AgentService(
              {
                ...other,
                chat: async () => ({ kind: 'final', content: 'Cevap', citedChunkIds: ['fake'] }),
              },
              new SearchDocsTool(knowledge),
              new SaveMemoryTool(memory),
              config,
            ).run(context),
          ),
        Boolean,
      );
      await check(
        '23',
        'provider never resolves',
        'timeout rejection',
        () =>
          throws(() =>
            new AgentService(
              { ...other, chat: async () => new Promise(() => {}) },
              new SearchDocsTool(knowledge),
              new SaveMemoryTool(memory),
              { ...config, AGENT_TIMEOUT_MS: 25 },
            ).run(context),
          ),
        Boolean,
      );
      await check(
        '23',
        'late save_memory after timeout',
        'no write after aborted run',
        async () => {
          const before = await memory.list(user.id);
          let error = '';
          try {
            await new AgentService(
              {
                ...other,
                chat: async () => {
                  await new Promise((resolve) => setTimeout(resolve, 30));
                  return {
                    kind: 'tool_calls',
                    calls: [
                      {
                        id: 'late',
                        name: 'save_memory',
                        arguments: { key: 'name', value: 'Deniz' },
                      },
                    ],
                  };
                },
              },
              new SearchDocsTool(knowledge),
              new SaveMemoryTool(memory),
              { ...config, AGENT_TIMEOUT_MS: 5 },
            ).run({ ...context, currentMessage: 'Adım Deniz.' });
          } catch (e) {
            error = e instanceof Error ? e.message : '';
          }
          await new Promise((resolve) => setTimeout(resolve, 45));
          return { error, before, after: await memory.list(user.id) };
        },
        (r) =>
          r.error.includes('süresi doldu') && JSON.stringify(r.before) === JSON.stringify(r.after),
      );
      let repeated = 0;
      await check(
        '24',
        'endless repeated tool',
        'step limit rejection',
        () =>
          throws(() =>
            new AgentService(
              {
                ...other,
                chat: async () => ({
                  kind: 'tool_calls',
                  calls: [
                    { id: String(++repeated), name: 'search_docs', arguments: { query: 'izin' } },
                  ],
                }),
              },
              new SearchDocsTool(knowledge),
              new SaveMemoryTool(memory),
              config,
            ).run(context),
          ),
        Boolean,
      );
      for (const invalid of [
        { name: 'delete_all', arguments: {} },
        { name: 'save_memory', arguments: { key: 'name', value: 'Deniz', userId: 'other' } },
        { name: 'search_docs', arguments: { query: 'a'.repeat(4001) } },
      ])
        await check(
          '24',
          invalid,
          'error tool result; no operation executed',
          async () => {
            let received = false;
            await new AgentService(
              {
                ...other,
                chat: async (input) => {
                  if (input.toolResults.length) {
                    received = input.toolResults[0].output.kind === 'error';
                    return { kind: 'final', content: 'Tekrar deneyin.', citedChunkIds: [] };
                  }
                  return { kind: 'tool_calls', calls: [{ id: 'invalid', ...invalid }] };
                },
              },
              new SearchDocsTool(knowledge),
              new SaveMemoryTool(memory),
              config,
            ).run(context);
            return received;
          },
          Boolean,
        );
      const fake = {
        responses: { create: async () => ({ status: 'incomplete', output: [] }) },
        embeddings: {
          create: async () => ({
            data: [
              { index: 1, embedding: [2] },
              { index: 0, embedding: [1] },
            ],
          }),
        },
      };
      const contract = new OpenAIProvider(
        readConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'fake' }),
        fake as unknown as OpenAI,
      );
      await check(
        '25',
        'incomplete SDK output',
        'controlled rejection',
        () => throws(() => contract.chat(base)),
        Boolean,
      );
      await check(
        '25',
        'valid quote, wrong requested detail',
        'semantic verification rejects unrelated answer',
        async () => {
          const sdk = {
            responses: {
              create: async () => ({
                status: 'completed',
                output_text: '{"supported":true,"coverage":"unanswered"}',
              }),
            },
          };
          return new OpenAIProvider(config, sdk as unknown as OpenAI).chat({
            ...base,
            state: {
              verification: true,
              candidate: {
                kind: 'final',
                content: 'Oda takvimden rezerve edilir.',
                citedChunkIds: ['c1'],
              },
              evidence: ['Oda takvimden rezerve edilir.'],
            },
          });
        },
        (r) =>
          r.kind === 'final' && r.citedChunkIds.length === 0 && r.content.includes('bulamadım'),
      );
      for (const output of ['not JSON', '{}']) {
        const badClient = {
          responses: {
            create: async () => ({ status: 'completed', output: [], output_text: output }),
          },
        };
        await check(
          '25',
          output,
          'invalid final payload rejected',
          () => throws(() => new OpenAIProvider(config, badClient as unknown as OpenAI).chat(base)),
          Boolean,
        );
      }
      for (const data of [
        [],
        [{ index: 0, embedding: [1] }],
        [{ index: 0, embedding: Array(1536).fill(0) }],
        [{ index: 0, embedding: Array(1536).fill(NaN) }],
        [{ index: 1, embedding: Array(1536).fill(1) }],
      ]) {
        const badClient = { embeddings: { create: async () => ({ data }) } };
        await check(
          '25',
          {
            indexes: data.map((d) => d.index),
            size: data[0]?.embedding.length,
            first: String(data[0]?.embedding[0]),
          },
          'corrupt embeddings rejected',
          () =>
            throws(() =>
              new OpenAIProvider(config, badClient as unknown as OpenAI).embed(['test']),
            ),
          Boolean,
        );
      }
    } else {
      // Live memory checks use the real agent but test users in the isolated schema only.
      for (const item of memoryCases.filter(
        (item) => !process.env.EVAL_ONLY || new RegExp(process.env.EVAL_ONLY).test(item.text),
      )) {
        const u = await db.getRepository(User).save({});
        const t = await chat.create(u.id);
        await check(
          item.group,
          item.text,
          item.expected,
          async () => {
            await chat.send(u.id, t.id, item.text);
            return (await memory.list(u.id))
              .map(({ key, value }) => ({ key, value }))
              .sort((a, b) => a.key.localeCompare(b.key));
          },
          (r) =>
            JSON.stringify(r) ===
            JSON.stringify([...item.expected].sort((a, b) => a.key.localeCompare(b.key))),
        );
      }
    }
    if (!process.env.EVAL_ONLY)
      await dailyBehaviorChecks({ db, chat, memory, knowledge, llm, config, check });
    await saveReport(`${label}-${live ? 'live' : 'mock'}`, rows, {
      scores,
      vectorExtension: await db.query("SELECT extversion FROM pg_extension WHERE extname='vector'"),
      settings: {
        dimensions: 1536,
        searchTopK: config.SEARCH_TOP_K,
        searchMinScore: config.SEARCH_MIN_SCORE,
      },
    });
  } finally {
    if (remote) await remote.cleanup();
    else await db.destroy();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Evaluation failed');
  process.exitCode = 1;
});
