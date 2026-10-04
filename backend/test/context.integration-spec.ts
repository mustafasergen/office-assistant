import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { CONFIG, readConfig } from '../src/config/config';
import { createDataSource } from '../src/database/database.module';
import { Message, Thread } from '../src/database/entities';
import { MockLLM } from '../src/modules/llm/providers/mock.provider';
import { LLM_PROVIDER, ChatInput } from '../src/modules/llm/llm.types';
import { ConversationContextService } from '../src/modules/chat/context/conversation-context.service';
import { KnowledgeService } from '../src/modules/knowledge/knowledge.service';
import { MemoryService } from '../src/modules/memory/memory.service';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Dedicated *_test DB required');
const config = readConfig({
  ...process.env,
  DATABASE_URL: url,
  LLM_PROVIDER: 'mock',
  DOCUMENTS_DIR: resolve(__dirname, '../../fixtures/documents'),
});
describe('summary privacy and continuity on real PostgreSQL/pgvector', () => {
  let app: INestApplication, db: DataSource, llm: MockLLM;
  let alice: ReturnType<typeof request.agent>, bob: ReturnType<typeof request.agent>;
  beforeAll(async () => {
    const clean = createDataSource(config);
    await clean.initialize();
    await clean.runMigrations();
    await clean.query('TRUNCATE users,documents CASCADE');
    await clean.destroy();
    llm = new MockLLM();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG)
      .useValue(config)
      .overrideProvider(LLM_PROVIDER)
      .useValue(llm)
      .compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApp(app, config);
    await app.init();
    db = app.get(DataSource);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    alice = request.agent(app.getHttpServer());
    bob = request.agent(app.getHttpServer());
    await alice.post('/api/session').expect(201);
    await bob.post('/api/session').expect(201);
  });
  afterEach(() => jest.restoreAllMocks());
  const thread = async (client = alice) =>
    (await client.post('/api/threads').expect(201)).body.id as string;
  const send = (id: string, content: string, client = alice) =>
    client.post(`/api/threads/${id}/messages`).send({ content });
  const context = (id: string, client = alice) => client.get(`/api/threads/${id}/context`);
  async function owner(id: string) {
    return (await db.getRepository(Thread).findOneByOrFail({ id })).userId;
  }
  it('P1/P2 before threshold: delete removes personal raw context but preserves leave application', async () => {
    const id = await thread();
    await send(id, 'İzin başvurusu nasıl yapılır?').expect(201);
    await send(id, 'Veganım').expect(201);
    const memories = (await alice.get('/api/memories')).body;
    await alice.delete(`/api/memories/${memories[0].id}`).expect(204);
    expect((await context(id)).body.summary).toContain('İzin başvuru süreci');
    expect((await context(id)).body.summary).not.toMatch(/vegan/i);
    const calls: ChatInput[] = [];
    const original = llm.chat.bind(llm);
    jest.spyOn(llm, 'chat').mockImplementation(async (input) => {
      calls.push(
        structuredClone({
          currentMessage: input.currentMessage,
          history: input.history,
          summary: input.summary,
          memories: input.memories,
          toolResults: input.toolResults,
        }),
      );
      return original(input);
    });
    const answer = await send(id, 'Peki kaç gün önceden?').expect(201);
    expect(answer.body.assistantMessage.content).toContain('5 iş günü');
    expect(answer.body.assistantMessage.metadata.sources[0].title).toBe('İzin politikası');
    expect(JSON.stringify(calls.map((c) => [c.history, c.summary, c.memories]))).not.toMatch(
      /vegan/i,
    );
    const food = await send(id, 'Yemek seçenekleri neler?').expect(201);
    expect(food.body.assistantMessage.content).not.toContain('Beslenme tercihini');
    await send(id, 'Beslenme tercihim ne?')
      .expect(201)
      .expect((r) => expect(r.body.assistantMessage.content).toContain('bulunmuyor'));
    expect((await alice.get('/api/memories')).body).toHaveLength(0);
    expect(
      (await alice.get(`/api/threads/${id}/messages`)).body.some(
        (m: Message) => m.content === 'Veganım',
      ),
    ).toBe(true);
  });
  it('P1 updates use only latest preference; repetition does not advance revision', async () => {
    const id = await thread();
    await send(id, 'İzin başvurusu nasıl yapılır?').expect(201);
    await send(id, 'Veganım').expect(201);
    const uid = await owner(id);
    const memory = app.get(MemoryService);
    const first = await memory.snapshot(uid);
    await send(id, 'Veganım').expect(201);
    await send(id, 'Veganım').expect(201);
    expect((await memory.snapshot(uid)).revision).toBe(first.revision);
    await send(id, 'Eskiden vegandım, artık vejetaryenim.').expect(201);
    expect((await memory.snapshot(uid)).memories[0].value).toBe('vegetarian');
    const prepared = await app
      .get(ConversationContextService)
      .prepare(id, (await memory.snapshot(uid)).revision);
    expect(JSON.stringify(prepared.history)).not.toMatch(/vegan/i);
    await send(id, 'Peki kaç gün önceden?')
      .expect(201)
      .expect((r) => expect(r.body.assistantMessage.content).toContain('5 iş günü'));
  });
  it('P1 isolates users and threads; deleting memory applies to all old threads', async () => {
    const first = await thread();
    await send(first, 'Veganım').expect(201);
    await send(first, 'İzin başvurusu nasıl yapılır?').expect(201);
    const second = await thread();
    await send(second, 'Peki kaç gün önceden?')
      .expect(201)
      .expect((r) => expect(r.body.assistantMessage.metadata.sources).toEqual([]));
    await context(first, bob).expect(404);
    const m = (await alice.get('/api/memories')).body[0];
    await alice.delete(`/api/memories/${m.id}`).expect(204);
    await send(first, 'Peki kaç gün önceden?')
      .expect(201)
      .expect((r) => expect(r.body.assistantMessage.content).toContain('5 iş günü'));
    const bobId = await thread(bob);
    expect((await context(bobId, bob)).body.summary).toBeNull();
  });
  it('P2 compacts at 22 messages and is idempotent without dropping topic continuity', async () => {
    const id = await thread();
    await send(id, 'İzin başvurusu nasıl yapılır?').expect(201);
    for (let i = 0; i < 9; i++) await send(id, 'Teşekkürler').expect(201);
    expect((await context(id)).body.summary).toBeNull();
    await send(id, 'Teşekkürler').expect(201);
    const one = (await context(id)).body;
    expect(one.summary).toContain('İzin başvuru süreci');
    expect((await context(id)).body).toEqual(one);
    const prepared = await app.get(ConversationContextService).prepare(id, 0);
    expect(prepared.history).toHaveLength(8);
    expect(JSON.stringify(prepared.history)).not.toMatch(/izin|başvuru|5 iş günü/i);
    expect(prepared.summary).toContain('Özetlenen bölümdeki son konu: İzin başvuru süreci');
    expect((await alice.get(`/api/threads/${id}/messages`)).body).toHaveLength(22);
    await send(id, 'Peki kaç gün önceden?')
      .expect(201)
      .expect((r) => expect(r.body.assistantMessage.content).toContain('5 iş günü'));
  });
  it.each([
    ['Yıllık izin hakkım kaç iş günü?', '20 iş günü', 'İzin politikası'],
    [
      'Toplantı odasını nasıl rezerve ederim?',
      'şirket takviminden rezerve edilir',
      'Ofis kuralları',
    ],
    [
      'Ofiste telefon görüşmelerini nerede yapabilirim?',
      'telefon kabinlerinde veya toplantı odalarında',
      'Ofis kuralları',
    ],
  ])('P1 manual question returns actual cited evidence: %s', async (question, evidence, title) => {
    const id = await thread();
    const r = (await send(id, question).expect(201)).body.assistantMessage;
    expect(r.content).toContain(evidence);
    expect(r.metadata.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title, excerpt: expect.stringContaining(evidence) }),
      ]),
    );
  });
  it.each([
    'Yıllık izin hakkım hangi bankaya yatırılır?',
    'Yıllık izin hakkım nerede?',
    'Toplantı odasını kaç liraya rezerve ederim?',
    'Ofiste telefon görüşmelerini kaydetmek için hangi uygulama kullanılır?',
  ])('P1 inflection matching must not answer an absent detail: %s', async (question) => {
    const r = (await send(await thread(), question).expect(201)).body.assistantMessage;
    expect(r.content).toContain('bulamadım');
    expect(r.metadata.sources).toEqual([]);
  });
  it('P2 bare acknowledgement preserves the topic without asking clarification or retrieving', async () => {
    const id = await thread();
    await send(id, 'İzin başvurusu nasıl yapılır?').expect(201);
    const r = (await send(id, 'Peki.').expect(201)).body.assistantMessage;
    expect(r.content).not.toMatch(/kastediyor|anlayamadım|bulamadım|\?/i);
    expect(r.metadata.sources).toEqual([]);
    expect(r.metadata.tools).toEqual([]);
    const next = (await send(id, 'Peki kaç gün önceden?').expect(201)).body.assistantMessage;
    expect(next.content).toContain('5 iş günü');
    expect(next.metadata.sources[0].title).toBe('İzin politikası');
  });
  it('P2 summary cannot override explicit newer topics; ambiguous followups have no sources', async () => {
    const id = await thread();
    await send(id, 'İzin başvurusu nasıl yapılır?').expect(201);
    await send(id, 'Veganım').expect(201);
    await send(id, 'Yemek kartı limiti ne kadar?').expect(201);
    await send(id, 'Peki kaç gün önceden?')
      .expect(201)
      .expect((r) => {
        expect(r.body.assistantMessage.content).toContain('Hangi konuyu');
        expect(r.body.assistantMessage.metadata.sources).toEqual([]);
      });
    await send(id, 'İzin başvurusu ve toplantı odası rezervasyonu nasıl yapılır?').expect(201);
    await send(id, 'Peki kaç gün önceden?')
      .expect(201)
      .expect((r) =>
        expect(r.body.assistantMessage.content).toBe('İzin başvurusunu mu kastediyorsun?'),
      );
  });
  it.each(['delete', 'update'])(
    'P2 concurrent %s discards an in-flight answer rather than publishing stale personalization',
    async (change) => {
      const id = await thread();
      await send(id, 'Veganım').expect(201);
      const m = (await alice.get('/api/memories')).body[0];
      const original = llm.chat.bind(llm);
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((r) => (entered = r)),
        gate = new Promise<void>((r) => (release = r));
      jest.spyOn(llm, 'chat').mockImplementationOnce(async (input) => {
        entered();
        await gate;
        return original(input);
      });
      const pending = send(id, 'Yemek seçenekleri neler?').then((r) => r);
      await started;
      if (change === 'delete') await alice.delete(`/api/memories/${m.id}`).expect(204);
      else
        await app
          .get(MemoryService)
          .save(await owner(id), m.sourceMessageId, 'dietary_preference', 'vegetarian');
      release();
      expect((await pending).status).toBe(409);
      const remaining = (await alice.get('/api/memories')).body;
      if (change === 'delete') expect(remaining).toHaveLength(0);
      else expect(remaining).toMatchObject([{ value: 'vegetarian' }]);
      const rows = (await alice.get(`/api/threads/${id}/messages`)).body;
      expect(rows.at(-1).status).toBe('failed');
    },
  );
  it('P2 long text triggers compaction without exceeding history budget', async () => {
    const id = await thread();
    for (let i = 0; i < 4; i++) await send(id, 'Teşekkürler ' + 'a'.repeat(3800)).expect(201);
    const prepared = await app.get(ConversationContextService).prepare(id, 0);
    expect(prepared.publicContext.summary).not.toBeNull();
    expect(prepared.history.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(8000);
  });
  it('P1 summary always retrieves fresh sources after document edits', async () => {
    const id = await thread();
    await send(id, 'İzin başvurusu nasıl yapılır?').expect(201);
    await send(id, 'Veganım').expect(201);
    const knowledge = app.get(KnowledgeService);
    const doc = (await knowledge.list()).find((d) => d.title === 'İzin politikası')!;
    const original = await knowledge.get(doc.id);
    try {
      await knowledge.update(doc.id, {
        ...original,
        content: original.content.replace('5 iş günü', '7 iş günü'),
      });
      await send(id, 'Peki kaç gün önceden?')
        .expect(201)
        .expect((r) => {
          expect(r.body.assistantMessage.content).toContain('7 iş günü');
          expect(r.body.assistantMessage.metadata.sources[0].excerpt).toContain('7 iş günü');
          expect(r.body.assistantMessage.content).not.toContain('5 iş günü');
        });
    } finally {
      const current = await knowledge.get(doc.id);
      await knowledge.update(doc.id, { ...original, revision: current.revision });
    }
  });
  it('P1/P2 migration marks legacy text untrusted and orders it chronologically', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('CREATE SCHEMA summary_migration_test');
      await runner.query('SET LOCAL search_path = summary_migration_test');
      await runner.query(
        'CREATE TABLE users (id integer); CREATE TABLE threads (id integer); CREATE TABLE messages (id integer PRIMARY KEY, thread_id integer, created_at timestamptz)',
      );
      await runner.query("INSERT INTO messages VALUES (2,1,'2026-10-02'),(1,1,'2026-10-01')");
      await runner.query(
        await readFile(
          resolve(__dirname, '../supabase/migrations/1791120000000-conversation-context.sql'),
          'utf8',
        ),
      );
      const rows = await runner.query(
        'SELECT id,context_revision FROM messages ORDER BY context_order',
      );
      expect(rows).toEqual([
        { id: 1, context_revision: -1 },
        { id: 2, context_revision: -1 },
      ]);
      const inserted = await runner.query(
        'INSERT INTO messages(id,thread_id,created_at) VALUES(3,1,now()) RETURNING context_revision,context_order',
      );
      expect(inserted[0]).toEqual({ context_revision: 0, context_order: '3' });
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
  it('P1 legacy transcripts lose personal raw text but retain company topics', async () => {
    const id = await thread();
    await db.getRepository(Message).save([
      {
        threadId: id,
        role: 'user',
        content: 'Veganım. İzin başvurusu nasıl yapılır?',
        status: 'completed',
        contextRevision: -1,
      },
      {
        threadId: id,
        role: 'assistant',
        content: 'Vegan tercihini hatırlıyorum.',
        status: 'completed',
        contextRevision: -1,
      },
    ]);
    const prepared = await app.get(ConversationContextService).prepare(id, 0);
    expect(prepared.history).toEqual([]);
    expect(prepared.summary).toContain('İzin başvuru süreci');
    expect(prepared.summary).not.toMatch(/vegan/i);
    expect(await db.getRepository(Message).countBy({ threadId: id })).toBe(2);
  });
  it('P2 summary failure after commit does not turn a successful chat into a failed message', async () => {
    const id = await thread();
    const ctx = app.get(ConversationContextService);
    const prepare = ctx.prepare.bind(ctx);
    jest.spyOn(ctx, 'prepare').mockImplementation(async (threadId, revision) => {
      if (
        await db
          .getRepository(Message)
          .countBy({ threadId, role: 'assistant', status: 'completed' })
      )
        throw new Error('test summary failure');
      return prepare(threadId, revision);
    });
    await send(id, 'Merhaba').expect(201);
    const rows = await db.getRepository(Message).findBy({ threadId: id });
    expect(rows).toHaveLength(2);
    expect(rows.every((m) => m.status === 'completed')).toBe(true);
  });
});
