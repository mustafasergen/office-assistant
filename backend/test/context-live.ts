/** Explicit opt-in live API evaluation. Always local disposable PostgreSQL, never Supabase. */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { readConfig } from '../src/config/config';
import { createDataSource } from '../src/database/database.module';
import { User, Message } from '../src/database/entities';
import { OpenAIProvider } from '../src/modules/llm/providers/openai.provider';
import { MockLLM } from '../src/modules/llm/providers/mock.provider';
import { KnowledgeService } from '../src/modules/knowledge/knowledge.service';
import { MemoryService } from '../src/modules/memory/memory.service';
import { AgentService } from '../src/modules/agent/agent.service';
import { SaveMemoryTool } from '../src/modules/agent/tools/save-memory.tool';
import { SearchDocsTool } from '../src/modules/agent/tools/search-docs.tool';
import { ChatService } from '../src/modules/chat/chat.service';
import { ConversationContextService } from '../src/modules/chat/context/conversation-context.service';

async function main() {
  if (process.env.RUN_LIVE_CONTEXT !== '1') throw new Error('RUN_LIVE_CONTEXT=1 required');
  const url = process.env.TEST_DATABASE_URL;
  if (
    !url ||
    !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test')
  )
    throw new Error('Local disposable *_test database required');
  loadEnv({ path: resolve(__dirname, '../../.env'), quiet: true });
  const config = readConfig({
    ...process.env,
    DATABASE_URL: url,
    LLM_PROVIDER: 'openai',
    DOCUMENTS_DIR: resolve(__dirname, '../../fixtures/documents'),
  });
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, maxRetries: 0, timeout: 30000 });
  const usage: { kind: string; input: number; output: number; estimatedUSD: number }[] = [];
  let afterResponse: (() => Promise<void>) | undefined;
  const limit = () => {
    if (usage.length >= 100 || usage.reduce((n, c) => n + c.estimatedUSD, 0) > 0.45)
      throw new Error('Live evaluation budget reached');
  };
  const chatCall = client.responses.create.bind(client.responses);
  client.responses.create = (async (
    body: OpenAI.Responses.ResponseCreateParamsNonStreaming,
    options?: unknown,
  ) => {
    limit();
    const response = await chatCall(body, options as never);
    const input = response.usage?.input_tokens ?? 0,
      output = response.usage?.output_tokens ?? 0;
    usage.push({ kind: 'chat', input, output, estimatedUSD: (input * 0.4 + output * 1.6) / 1e6 });
    const hook = afterResponse;
    afterResponse = undefined;
    if (hook) await hook();
    return response;
  }) as typeof client.responses.create;
  const embedCall = client.embeddings.create.bind(client.embeddings);
  client.embeddings.create = (async (body: OpenAI.EmbeddingCreateParams, options?: unknown) => {
    limit();
    const response = await embedCall(body, options as never);
    const input = response.usage.total_tokens;
    usage.push({ kind: 'embedding', input, output: 0, estimatedUSD: (input * 0.02) / 1e6 });
    return response;
  }) as typeof client.embeddings.create;
  const provider = new OpenAIProvider(config, client),
    db = createDataSource(config);
  await db.initialize();
  await db.runMigrations();
  const memory = new MemoryService(db),
    context = new ConversationContextService(db),
    knowledge = new KnowledgeService(db, provider, config);
  const agent = new AgentService(
    provider,
    new SearchDocsTool(knowledge),
    new SaveMemoryTool(memory),
    config,
  );
  const chat = new ChatService(db, agent, memory, context);
  const results: {
    priority: string;
    input: string;
    expected: string;
    actual: unknown;
    passed: boolean;
  }[] = [];
  const check = async (
    priority: string,
    input: string,
    expected: string,
    run: () => Promise<unknown>,
  ) => {
    try {
      const actual = await run();
      results.push({ priority, input, expected, actual, passed: true });
    } catch (e) {
      results.push({
        priority,
        input,
        expected,
        actual: {
          error: e instanceof Error ? e.name : 'Error',
          detail:
            e instanceof assert.AssertionError ? e.message : 'Request failed (details omitted)',
        },
        passed: false,
      });
    }
    console.log(JSON.stringify({ test: input, passed: results.at(-1)!.passed }));
  };
  try {
    await db.query('TRUNCATE users,documents CASCADE');
    await knowledge.ensureIndex();
    const user = await db.getRepository(User).save({});
    const thread = await chat.create(user.id);
    const send = (text: string) => chat.send(user.id, thread.id, text);
    await check(
      'P1',
      'İzin başvurusu nasıl yapılır?',
      'Live embedding/retrieval selects leave policy with sources',
      async () => {
        const r = await send('İzin başvurusu nasıl yapılır?');
        assert(r.assistantMessage.metadata.sources?.some((s) => s.title === 'İzin politikası'));
        return r.assistantMessage;
      },
    );
    await check(
      'P2',
      'İzin başvurusu → Peki. → Peki kaç gün önceden?',
      'Bare acknowledgement does not clarify or retrieve; real follow-up still uses the leave source',
      async () => {
        const acknowledgement = (await send('Peki.')).assistantMessage;
        assert(!/kastediyor|anlayamadım|bulamadım/i.test(acknowledgement.content));
        assert.equal(acknowledgement.metadata.sources?.length, 0);
        assert.deepEqual(acknowledgement.metadata.tools, []);
        const followup = (await send('Peki kaç gün önceden?')).assistantMessage;
        assert.match(followup.content, /5 iş gün/);
        assert(followup.metadata.sources?.some((s) => s.title === 'İzin politikası'));
        return { acknowledgement, followup };
      },
    );
    await check(
      'P1',
      'Veganım → panelden sil → Peki kaç gün önceden?',
      'Below threshold: no vegan raw history; leave context and fresh source survive',
      async () => {
        await send('Veganım');
        const fact = (await memory.list(user.id))[0];
        assert.equal(fact.value, 'vegan');
        await memory.delete(user.id, fact.id);
        const prepared = await context.prepare(
          thread.id,
          (await memory.snapshot(user.id)).revision,
        );
        assert(!/vegan/i.test(JSON.stringify([prepared.history, prepared.summary])));
        const r = await send('Peki kaç gün önceden?');
        assert.match(r.assistantMessage.content, /5 iş gün/);
        assert(r.assistantMessage.metadata.sources?.some((s) => s.title === 'İzin politikası'));
        assert.equal((await memory.list(user.id)).length, 0);
        return { context: prepared.publicContext, answer: r.assistantMessage };
      },
    );
    await check(
      'P1',
      'Silme sonrası Yemek seçenekleri neler?',
      'No deleted-preference personalization; current food sources',
      async () => {
        const r = await send('Yemek seçenekleri neler?');
        assert(
          !/vegan (?:tercih|oldu|beslen)|tercihin[^.]*vegan|sana özel[^.]*vegan/i.test(
            r.assistantMessage.content,
          ),
        );
        assert(r.assistantMessage.metadata.sources?.length);
        assert.equal((await memory.list(user.id)).length, 0);
        return r.assistantMessage;
      },
    );
    await check(
      'P1',
      'Silme sonrası Beslenme tercihim ne?',
      'Missing memory, no recreation',
      async () => {
        const r = await send('Beslenme tercihim ne?');
        assert.match(r.assistantMessage.content, /bulunmuyor/);
        assert.equal((await memory.list(user.id)).length, 0);
        return r.assistantMessage.content;
      },
    );
    await check(
      'P1',
      'Veganım → Eskiden vegandım, artık vejetaryenim → yemek seçenekleri',
      'Only current vegetarian preference; no old vegan history',
      async () => {
        await send('Veganım');
        await send('Eskiden vegandım, artık vejetaryenim.');
        assert.equal((await memory.list(user.id))[0].value, 'vegetarian');
        const c = await context.prepare(thread.id, (await memory.snapshot(user.id)).revision);
        assert(!/vegan/i.test(JSON.stringify([c.history, c.summary])));
        const r = await send('Yemek seçenekleri neler?');
        assert(!/vegan (?:tercih|oldu)|tercihin[^.]*vegan/i.test(r.assistantMessage.content));
        return r.assistantMessage;
      },
    );
    await check(
      'P1',
      'Arkadaşım vegan; benim kayıtlı tercihim ne?',
      'Third-party statement cannot overwrite vegetarian memory',
      async () => {
        const r = await send('Arkadaşım vegan; benim kayıtlı tercihim ne?');
        assert.equal((await memory.list(user.id))[0].value, 'vegetarian');
        return r.assistantMessage.content;
      },
    );
    await check(
      'P2',
      '22 seeded completed messages → Peki kaç gün önceden?',
      'Real OpenAI uses compacted leave topic with a current source',
      async () => {
        const u = await db.getRepository(User).save({});
        const t = await chat.create(u.id);
        for (let i = 0; i < 22; i++)
          await db.getRepository(Message).save({
            threadId: t.id,
            role: i % 2 ? 'assistant' : 'user',
            content:
              i === 0 ? 'İzin başvurusu nasıl yapılır?' : i % 2 ? 'Rica ederim.' : 'Teşekkürler',
            contextRevision: 0,
            status: 'completed',
          });
        const prepared = await context.prepare(t.id, 0);
        assert(!/izin|başvuru|5 iş günü/i.test(JSON.stringify(prepared.history)));
        assert(prepared.summary?.includes('Özetlenen bölümdeki son konu: İzin başvuru süreci'));
        const r = await chat.send(u.id, t.id, 'Peki kaç gün önceden?');
        assert.match(r.assistantMessage.content, /5 iş gün/);
        assert(r.context.summary);
        return r;
      },
    );
    await check(
      'P2',
      'Yeni açık yemek kartı konusu → Peki kaç gün önceden?',
      'Clarification, no source and no extra OpenAI call for ambiguous followup',
      async () => {
        await send('Yemek kartı limiti ne kadar?');
        const n = usage.length;
        const r = await send('Peki kaç gün önceden?');
        assert.match(r.assistantMessage.content, /Hangi konuyu/);
        assert.equal(usage.length, n);
        assert.equal(r.assistantMessage.metadata.sources?.length, 0);
        return r.assistantMessage;
      },
    );
    for (const [query, title, expected] of [
      ['Yıllık izin hakkım kaç iş günü?', 'İzin politikası', /20 iş gün/],
      ['Toplantı odasını nasıl rezerve ederim?', 'Ofis kuralları', /takvim/i],
      [
        'Ofiste telefon görüşmelerini nerede yapabilirim?',
        'Ofis kuralları',
        /telefon kabin.*toplantı oda/is,
      ],
    ] as const) {
      await check('P1', query, 'Current fixture answer with the correct source', async () => {
        const t = await chat.create(user.id);
        const r = (await chat.send(user.id, t.id, query)).assistantMessage;
        assert.match(r.content, expected);
        assert(r.metadata.sources?.some((source) => source.title === title));
        return r;
      });
    }
    await check(
      'P2',
      'Live model response in flight while memory is deleted',
      '409 conflict and no stale answer published',
      async () => {
        const fact = (await memory.list(user.id))[0];
        assert(fact);
        afterResponse = () => memory.delete(user.id, fact.id);
        await assert.rejects(
          send('Yemek seçenekleri neler?'),
          (e) => e instanceof Error && /Hafıza/.test(e.message),
        );
        assert.equal((await memory.list(user.id)).length, 0);
        return 'Conflicting response rejected; memory remains empty';
      },
    );
  } finally {
    afterResponse = undefined;
    await db.query('TRUNCATE users,documents CASCADE');
    await new KnowledgeService(
      db,
      new MockLLM(),
      readConfig({
        ...process.env,
        DATABASE_URL: url,
        LLM_PROVIDER: 'mock',
        DOCUMENTS_DIR: config.DOCUMENTS_DIR,
      }),
    ).ensureIndex();
    await db.destroy();
    const dir = resolve(__dirname, '../../docs/test-reports');
    await mkdir(dir, { recursive: true });
    await writeFile(
      resolve(dir, process.env.LIVE_CONTEXT_REPORT ?? 'conversation-summary-openai-live.json'),
      JSON.stringify(
        {
          date: new Date().toISOString(),
          environment: 'Real OpenAI API + isolated local PostgreSQL/pgvector; no Supabase changes',
          models: { chat: config.OPENAI_CHAT_MODEL, embedding: config.OPENAI_EMBEDDING_MODEL },
          results,
          usage,
          estimatedUSD: usage.reduce((n, c) => n + c.estimatedUSD, 0),
          cleanup: 'Only isolated test DB reset to four mock seed documents',
        },
        null,
        2,
      ),
    );
  }
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
main().catch((e) => {
  console.error('Live evaluation failed:', e instanceof Error ? e.name : 'Error');
  process.exitCode = 1;
});
