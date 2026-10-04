import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { CONFIG, readConfig } from '../src/config/config';
import { createDataSource } from '../src/database/database.module';
import { DocumentChunk, Memory, Message } from '../src/database/entities';
import { KnowledgeService } from '../src/modules/knowledge/knowledge.service';
import { MockLLM } from '../src/modules/llm/providers/mock.provider';
import { LLM_PROVIDER, LLMProvider } from '../src/modules/llm/llm.types';
import { ChatService } from '../src/modules/chat/chat.service';
import { AgentService } from '../src/modules/agent/agent.service';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('TEST_DATABASE_URL must point to a dedicated *_test database.');
const config = readConfig({
  ...process.env,
  DATABASE_URL: url,
  LLM_PROVIDER: 'mock',
  DOCUMENTS_DIR: process.env.DOCUMENTS_DIR ?? resolve(__dirname, '../../fixtures/documents'),
});

describe('PostgreSQL + pgvector API integration', () => {
  let app: INestApplication;
  let db: DataSource;
  let llm: MockLLM;
  let alice: ReturnType<typeof request.agent>;
  let bob: ReturnType<typeof request.agent>;

  async function boot() {
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
  }
  beforeAll(async () => {
    const cleanup = createDataSource(config);
    await cleanup.initialize();
    await cleanup.runMigrations();
    await cleanup.query('TRUNCATE users, documents CASCADE');
    await cleanup.destroy();
    await boot();
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
  const thread = async (client = alice): Promise<string> =>
    (await client.post('/api/threads').expect(201)).body.id as string;
  const send = (id: string, content: string, client = alice) =>
    client.post(`/api/threads/${id}/messages`).send({ content });

  it('uses secure cookie attributes and isolates anonymous identities', async () => {
    const res = await request(app.getHttpServer()).post('/api/session').expect(201);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(res.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
    const id = await thread();
    await bob.get(`/api/threads/${id}/messages`).expect(404);
    await send(id, 'Merhaba', bob).expect(404);
    await request(app.getHttpServer()).get('/api/threads').expect(401);
    await request(app.getHttpServer())
      .get('/api/threads')
      .set('Cookie', 'uplico_user=s%3Atampered.signature')
      .expect(401);
  });
  it('retrieves the correct document and returns verifiable source content', async () => {
    const spy = jest.spyOn(llm, 'chat');
    const response = await send(await thread(), 'Yıllık izin kaç gün?').expect(201);
    expect(response.body.assistantMessage.content).toContain('20 iş günü');
    expect(response.body.assistantMessage.metadata.tools).toEqual(['search_docs']);
    expect(spy).toHaveBeenCalledTimes(2);
    const source = response.body.assistantMessage.metadata.sources[0];
    expect(source.title).toBe('İzin politikası');
    expect(source.excerpt).toContain('20 iş günü');
    const doc = await alice.get(`/api/documents/${source.documentId}`).expect(200);
    for (const part of source.excerpt.split('\n').filter(Boolean))
      expect(doc.body.content).toContain(part);
    spy.mockRestore();
  });
  it('answers unrelated questions without invented sources', async () => {
    const response = await send(await thread(), 'Mars gezegeninin çapı kaç kilometre?').expect(201);
    expect(response.body.assistantMessage.content).toContain('bulamadım');
    expect(response.body.assistantMessage.metadata.sources).toEqual([]);
  });
  it('saves/upserts memory, uses it in a new thread, deletes it, and never resurrects it', async () => {
    const first = await thread();
    const combined = await send(first, 'Vejetaryenim, yemek seçenekleri neler?').expect(201);
    expect(combined.body.assistantMessage.metadata.tools).toEqual(['save_memory', 'search_docs']);
    expect(combined.body.assistantMessage.content).toContain('Beslenme tercihini (vejetaryen)');
    await send(first, 'Vejetaryenim').expect(201);
    const memories = await alice.get('/api/memories').expect(200);
    expect(memories.body).toHaveLength(1);
    expect((await bob.get('/api/memories')).body).toHaveLength(0);
    await bob.delete(`/api/memories/${memories.body[0].id}`).expect(404);
    const second = await thread();
    const recalled = await send(second, 'Yemek seçenekleri neler?').expect(201);
    expect(recalled.body.assistantMessage.content).toContain('Beslenme tercihini (vejetaryen)');
    await alice.delete(`/api/memories/${memories.body[0].id}`).expect(204);
    expect((await alice.get('/api/memories')).body).toEqual([]);
    const sameThread = await send(first, 'Beslenme tercihim ne?').expect(201);
    expect(sameThread.body.assistantMessage.content).toContain('şu an hafızamda bulunmuyor');
    expect(sameThread.body.assistantMessage.metadata.sources).toEqual([]);
    expect(sameThread.body.assistantMessage.metadata.tools).toEqual([]);
    expect((await alice.get(`/api/threads/${first}/messages`)).body).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Vejetaryenim' })]),
    );
    await send(first, 'Merhaba').expect(201);
    const third = await send(await thread(), 'Yemek seçenekleri neler?').expect(201);
    expect(third.body.assistantMessage.content).not.toContain('Beslenme tercihini');
    expect((await alice.get('/api/memories')).body).toEqual([]);
    await send(second, 'Veganım').expect(201);
    await send(second, 'Vejetaryen değilim').expect(201);
    const updated = await alice.get('/api/memories');
    expect(updated.body).toHaveLength(1);
    expect(updated.body[0].value).toBe('vegan');
    await send(second, 'Vegan değilim').expect(201);
    expect((await alice.get('/api/memories')).body).toEqual([]);
  });
  it('rejects extra identity fields and empty messages', async () => {
    const id = await thread();
    await alice
      .post(`/api/threads/${id}/messages`)
      .send({ content: 'hi', userId: 'other' })
      .expect(400);
    const model = jest.spyOn(llm, 'chat');
    for (const content of ['', ' ', '?!...', '\u200b', 'a'.repeat(4001)])
      await send(id, content).expect(400);
    expect(model).not.toHaveBeenCalled();
    expect((await alice.get(`/api/threads/${id}/messages`)).body).toEqual([]);
    model.mockRestore();
  });
  it('does not embed or duplicate documents on an unchanged seed', async () => {
    const embed = jest.spyOn(llm, 'embed');
    const before = await db.getRepository(DocumentChunk).find({ order: { id: 'ASC' } });
    await app.get(KnowledgeService).ensureIndex();
    expect(embed).not.toHaveBeenCalled();
    expect(await db.getRepository(DocumentChunk).find({ order: { id: 'ASC' } })).toEqual(before);
    const rows = await db.query(
      'SELECT DISTINCT vector_dims(embedding) AS dimensions FROM document_chunks',
    );
    expect(rows).toEqual([{ dimensions: 1536 }]);
    embed.mockRestore();
  });
  it('reindexes changed embedding spaces atomically and refuses mixed-space searches', async () => {
    const count = await db.getRepository(DocumentChunk).count();
    const alternative: LLMProvider = {
      embeddingKey: 'test:other-space:1536',
      chat: (input) => llm.chat(input),
      embed: jest.fn((texts, signal) => llm.embed(texts, signal)),
    };
    const index = new KnowledgeService(db, alternative, config);
    await index.ensureIndex();
    expect(alternative.embed).toHaveBeenCalled();
    expect(
      await db.getRepository(DocumentChunk).countBy({ embeddingKey: alternative.embeddingKey }),
    ).toBe(count);
    expect(await app.get(KnowledgeService).search('yıllık izin')).toEqual([]);
    const failing = {
      ...alternative,
      embeddingKey: 'broken:space',
      embed: jest.fn().mockRejectedValue(new Error('embedding outage')),
    };
    await expect(new KnowledgeService(db, failing, config).ensureIndex()).rejects.toThrow(
      'embedding outage',
    );
    expect(
      await db.getRepository(DocumentChunk).countBy({ embeddingKey: alternative.embeddingKey }),
    ).toBe(count);
    await app.get(KnowledgeService).ensureIndex();
    expect(await db.getRepository(DocumentChunk).count()).toBe(count);
  });
  it('marks failed runs and prevents simultaneous runs in the same thread', async () => {
    const userId = (await alice.post('/api/session')).body.id as string;
    const id = await thread();
    let release!: () => void;
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = jest.spyOn(app.get(AgentService), 'run').mockImplementationOnce(async () => {
      started();
      await gate;
      throw new Error('upstream');
    });
    const first = app.get(ChatService).send(userId, id, 'İzin?');
    const assertion = expect(first).rejects.toThrow('yanıt veremiyor');
    await start;
    await expect(app.get(ChatService).send(userId, id, 'İkinci')).rejects.toThrow(
      'yanıt hazırlanıyor',
    );
    await alice.delete(`/api/threads/${id}`).expect(409);
    release();
    await assertion;
    spy.mockRestore();
    const messages = await db.getRepository(Message).findBy({ threadId: id });
    expect(messages).toHaveLength(1);
    expect(messages[0].status).toBe('failed');
  });
  it('deletes only owned conversations while preserving separately managed memory', async () => {
    const id = await thread();
    await send(id, 'Vejetaryenim').expect(201);
    const memory = (await alice.get('/api/memories')).body[0];
    await bob.delete(`/api/threads/${id}`).expect(404);
    await alice.delete(`/api/threads/${id}`).expect(204);
    await alice.get(`/api/threads/${id}/messages`).expect(404);
    expect(await db.getRepository(Message).countBy({ threadId: id })).toBe(0);
    expect(await db.getRepository(Memory).findOneBy({ id: memory.id })).toMatchObject({
      value: 'vegetarian',
      sourceMessageId: null,
    });
    await alice.delete(`/api/threads/${id}`).expect(404);
  });
  it('creates, edits and deletes indexed documents with validation and stale revision protection', async () => {
    const data = {
      title: 'Galaksi arşivi',
      description: 'Özel test açıklaması',
      content: 'Galaksi arşivinin erişim kodu TURKUAZ olarak belirlenmiştir.',
    };
    await request(app.getHttpServer()).post('/api/documents').send(data).expect(401);
    await alice
      .post('/api/documents')
      .send({ ...data, title: ' ' })
      .expect(400);
    await alice
      .post('/api/documents')
      .send({ ...data, content: '# Sadece başlık' })
      .expect(400);
    const created = (await alice.post('/api/documents').send(data).expect(201)).body;
    expect(
      (await app.get(KnowledgeService).search('Galaksi arşivinin erişim kodu')).some(
        (match) => match.documentId === created.id,
      ),
    ).toBe(true);
    const edited = {
      ...data,
      title: 'Galaksi kayıtları',
      description: '',
      content: 'Galaksi arşivinin erişim kodu MOR olarak değiştirilmiştir.',
      revision: created.revision,
    };
    const updated = (await alice.patch(`/api/documents/${created.id}`).send(edited).expect(200))
      .body;
    expect(updated.revision).toBe(created.revision + 1);
    await bob.patch(`/api/documents/${created.id}`).send(edited).expect(409);
    const matches = (
      await app.get(KnowledgeService).search('Galaksi arşivinin erişim kodu')
    ).filter((match) => match.documentId === created.id);
    expect(matches[0].content).toContain('MOR');
    expect(matches[0].content).not.toContain('TURKUAZ');
    const before = await db.getRepository(DocumentChunk).findBy({ documentId: created.id });
    const embed = jest
      .spyOn(llm, 'embed')
      .mockRejectedValueOnce(new Error('embedding unavailable'));
    await expect(
      app.get(KnowledgeService).update(created.id, {
        ...edited,
        revision: updated.revision,
        content: 'Başarısız güncelleme',
      }),
    ).rejects.toThrow('embedding unavailable');
    embed.mockRestore();
    expect((await alice.get(`/api/documents/${created.id}`)).body.content).toBe(edited.content);
    expect(await db.getRepository(DocumentChunk).findBy({ documentId: created.id })).toEqual(
      before,
    );
    await app.get(KnowledgeService).ensureIndex();
    expect((await alice.get(`/api/documents/${created.id}`)).body.description).toBe('');
    await alice.delete(`/api/documents/${created.id}`).expect(204);
    await alice.get(`/api/documents/${created.id}`).expect(404);
    expect(await db.getRepository(DocumentChunk).countBy({ documentId: created.id })).toBe(0);
    expect(
      (await app.get(KnowledgeService).search('Galaksi arşivinin erişim kodu')).some(
        (match) => match.documentId === created.id,
      ),
    ).toBe(false);
  });
  it('indexes description-only terms and replaces them when the description changes', async () => {
    const knowledge = app.get(KnowledgeService);
    const seeds = await knowledge.list();
    expect(seeds).toHaveLength(4);
    expect(seeds.every((doc) => doc.description.length > 30)).toBe(true);
    const created = await knowledge.create({
      title: 'Kontrol kaydı',
      description: 'Zümrüt pusula laboratuvarı',
      content: 'Başvurular ekip sorumlusuna iletilir.',
    });
    expect((await knowledge.search('Zümrüt pusula laboratuvarı'))[0].documentId).toBe(created.id);
    const spy = jest.spyOn(llm, 'embed');
    await knowledge.update(created.id, {
      title: created.title,
      content: created.content,
      description: '',
      revision: created.revision,
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(
      (await knowledge.search('Zümrüt pusula laboratuvarı')).some(
        (match) => match.documentId === created.id,
      ),
    ).toBe(false);
    await knowledge.delete(created.id);
  });
  it('keeps seed edits and deletions when rebuilding the index', async () => {
    const list = (await alice.get('/api/documents')).body;
    const seed = list.find((item: { title: string }) => item.title === 'Ofis kuralları');
    const data = {
      title: 'Güncellenmiş ofis rehberi',
      description: 'Güncel açıklama',
      content: 'Ofiste sessiz çalışma odası MAVİ olarak adlandırılır.',
      revision: seed.revision,
    };
    await alice.patch(`/api/documents/${seed.id}`).send(data).expect(200);
    await app.get(KnowledgeService).ensureIndex();
    expect((await alice.get(`/api/documents/${seed.id}`)).body.content).toBe(data.content);
    await alice.delete(`/api/documents/${seed.id}`).expect(204);
    await app.get(KnowledgeService).ensureIndex();
    await alice.get(`/api/documents/${seed.id}`).expect(404);
    expect(
      (await alice.get('/api/documents')).body.some((item: { id: string }) => item.id === seed.id),
    ).toBe(false);
  });
  it('preserves messages, memory, and anonymous cookie across application restart', async () => {
    const session = await alice.post('/api/session');
    const cookie = session.headers['set-cookie'][0].split(';')[0];
    const id = await thread();
    await send(id, 'Vejetaryenim').expect(201);
    const chunks = await db.getRepository(DocumentChunk).count();
    const memories = await db.getRepository(Memory).count();
    await app.close();
    await boot();
    expect(await db.getRepository(DocumentChunk).count()).toBe(chunks);
    expect(await db.getRepository(Memory).count()).toBe(memories);
    const history = await request(app.getHttpServer())
      .get(`/api/threads/${id}/messages`)
      .set('Cookie', cookie)
      .expect(200);
    expect(history.body).toHaveLength(2);
    const persisted = await request(app.getHttpServer())
      .get('/api/memories')
      .set('Cookie', cookie)
      .expect(200);
    expect(persisted.body[0].value).toBe('vegetarian');
  });
});
