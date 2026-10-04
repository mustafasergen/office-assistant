/* eslint-disable @typescript-eslint/no-explicit-any -- report checks inspect heterogeneous serializable results. */
import { DataSource } from 'typeorm';
import { User } from '../../src/database/entities';
import { ChatService } from '../../src/modules/chat/chat.service';
import { MemoryService } from '../../src/modules/memory/memory.service';
import { KnowledgeService } from '../../src/modules/knowledge/knowledge.service';
import { MockLLM } from '../../src/modules/llm/providers/mock.provider';
import { LLMProvider } from '../../src/modules/llm/llm.types';
import { AppConfig, readConfig } from '../../src/config/config';

type Check = (
  group: string,
  input: unknown,
  expected: unknown,
  run: () => unknown | Promise<unknown>,
  verify: (actual: any) => boolean,
) => Promise<void>;

/** Stateful product checks run identically against mock/local and real OpenAI/Supabase. */
export async function dailyBehaviorChecks({
  db,
  chat,
  memory,
  knowledge,
  llm,
  config,
  check,
}: {
  db: DataSource;
  chat: ChatService;
  memory: MemoryService;
  knowledge: KnowledgeService;
  llm: LLMProvider;
  config: AppConfig;
  check: Check;
}) {
  const user = await db.getRepository(User).save({});
  const thread = await chat.create(user.id);
  const send = async (text: string) => (await chat.send(user.id, thread.id, text)).assistantMessage;
  await check(
    '17',
    'Veganım → panel delete → SAME thread Beslenme tercihim ne?',
    'unknown current preference, no resurrection, original messages preserved',
    async () => {
      await send('Veganım.');
      const saved = (await memory.list(user.id))[0];
      await memory.delete(user.id, saved.id);
      const response = await send('Beslenme tercihim ne?');
      return {
        response,
        memories: await memory.list(user.id),
        originalMessagePreserved: (await chat.messages(user.id, thread.id)).some(
          (m) => m.role === 'user' && m.content === 'Veganım.',
        ),
      };
    },
    (r) =>
      r.response.content === 'Beslenme tercihi bilgisi şu an hafızamda bulunmuyor.' &&
      !r.response.metadata.sources.length &&
      !r.response.metadata.tools.includes('save_memory') &&
      r.memories.length === 0 &&
      r.originalMessagePreserved,
  );
  if (llm.embeddingKey.startsWith('openai:')) {
    for (const question of [
      'Beslenmeyle ilgili hafızanda bana ait ne var?',
      'Benimle ilgili neleri hatırlıyorsun?',
      'Ben vegan mıyım?',
    ])
      await check(
        '17',
        `same thread after panel delete: ${question}`,
        'unknown current preference, no stale vegan claim and no memory writes',
        async () => ({ response: await send(question), memories: await memory.list(user.id) }),
        (r) =>
          /hafızamda bulunmuyor/.test(r.response.content) &&
          !/vegan|vejetaryen/i.test(r.response.content) &&
          r.memories.length === 0 &&
          !r.response.metadata.sources.length,
      );
  }
  await check(
    '17',
    'same thread after panel delete → Yemek seçenekleri neler?',
    'sourced general food options, no assertion of a remembered personal preference',
    async () => ({
      response: await send('Yemek seçenekleri neler?'),
      memories: await memory.list(user.id),
    }),
    (r) =>
      r.memories.length === 0 &&
      r.response.metadata.sources.length > 0 &&
      !/tercihini|tercihiniz|vegan oldu|vejetaryen oldu|vegan olduğ|vejetaryen olduğ/i.test(
        r.response.content,
      ),
  );
  if (llm.embeddingKey.startsWith('openai:')) {
    await check(
      '17',
      'save name/department/diet → delete only diet → same thread recall all',
      'name and department retained, deleted diet absent',
      async () => {
        const other = await db.getRepository(User).save({});
        const t = await chat.create(other.id);
        await chat.send(other.id, t.id, 'Adım İpek. Tasarım departmanında çalışıyorum. Veganım.');
        const preference = (await memory.list(other.id)).find(
          (m) => m.key === 'dietary_preference',
        )!;
        await memory.delete(other.id, preference.id);
        return (await chat.send(other.id, t.id, 'Benimle ilgili neleri hatırlıyorsun?'))
          .assistantMessage;
      },
      (r) =>
        r.content.includes('İsim: İpek.') &&
        r.content.includes('Departman: Tasarım.') &&
        r.content.includes('Beslenme tercihi bilgisi şu an hafızamda bulunmuyor.') &&
        !/vegan/i.test(r.content),
    );
  }
  await check(
    '16',
    'Veganım ×3',
    'one record, same ID and update timestamp',
    async () => {
      await send('Veganım.');
      const before = await memory.list(user.id);
      await send('Veganım.');
      await send('Veganım.');
      return { before, after: await memory.list(user.id) };
    },
    (r) =>
      r.before.length === 1 &&
      r.after.length === 1 &&
      r.before[0].id === r.after[0].id &&
      String(r.before[0].updatedAt) === String(r.after[0].updatedAt),
  );
  await check(
    '17',
    'new thread → Beslenme tercihim ne?',
    'recall vegan from persistent memory',
    async () => {
      const fresh = await chat.create(user.id);
      return (await chat.send(user.id, fresh.id, 'Beslenme tercihim ne?')).assistantMessage;
    },
    (r) => /vegan/i.test(r.content) && !r.metadata.sources?.length,
  );
  await check(
    '19',
    'Arkadaşım vejetaryen.',
    'does not overwrite own vegan preference',
    async () => {
      await send('Arkadaşım vejetaryen.');
      return memory.list(user.id);
    },
    (r) => r.length === 1 && r[0].value === 'vegan',
  );
  await check(
    '18',
    'Eskiden vegandım, şimdi vejetaryenim.',
    'one current vegetarian preference',
    async () => {
      await send('Eskiden vegandım, şimdi vejetaryenim.');
      return memory.list(user.id);
    },
    (r) => r.length === 1 && r[0].value === 'vegetarian',
  );
  await check(
    '17',
    'same thread with older vegan messages after update → Beslenme tercihim ne?',
    'current vegetarian only, no stale vegan value',
    () => send('Beslenme tercihim ne?'),
    (r) => r.content === 'Beslenme tercihi: vejetaryen.' && !r.metadata.sources.length,
  );
  await check(
    '18',
    'Vejetaryen değilim.',
    'retract vegetarian, do not invent unrestricted',
    async () => {
      await send('Vejetaryen değilim.');
      return memory.list(user.id);
    },
    (r) => r.length === 0,
  );
  await check(
    '17',
    'after retraction → new thread recall',
    'unknown, no memory resurrection',
    async () => {
      const fresh = await chat.create(user.id);
      const response = await chat.send(user.id, fresh.id, 'Beslenme tercihim ne?');
      return { content: response.assistantMessage.content, memories: await memory.list(user.id) };
    },
    (r) => r.memories.length === 0 && /bulunm|bilmi|kayıt|kaydet|paylaş|yok/i.test(r.content),
  );
  await check(
    '05',
    'asdkj qweqwe zzz',
    'ask for clarification, no tools/memory/policy assertion',
    async () => {
      const fresh = await chat.create(user.id);
      return (await chat.send(user.id, fresh.id, 'asdkj qweqwe zzz')).assistantMessage;
    },
    (r) => !r.metadata.sources?.length && /anla|açık|tekrar|yardımcı/i.test(r.content),
  );
  await check(
    '07',
    'annual duration vs advance notice',
    '20 days and 5 days: different answers to different intents',
    async () => {
      const first = await send('Yıllık izin kaç gün?');
      const second = await send('İzin talebimi ne kadar önceden iletmeliyim?');
      return { first: first.content, second: second.content };
    },
    (r) => /20/.test(r.first) && /5|beş/.test(r.second) && r.first !== r.second,
  );
  await check(
    '07',
    'Yıllık izin kaç gün ve ofisin posta kodu nedir?',
    '20 days with source; missing postal code explicitly unknown',
    () => send('Yıllık izin kaç gün ve ofisin posta kodu nedir?'),
    (r) =>
      /20/.test(r.content) &&
      /bulamad|bilgi.*yok|belirtilm|yer alm|bulunm/i.test(r.content) &&
      r.metadata.sources.some((s: { excerpt: string }) => s.excerpt.includes('20 iş günü')),
  );
  await check(
    '10',
    '4001-character search',
    'controlled length rejection',
    async () => {
      try {
        await knowledge.search('a'.repeat(4001));
        return false;
      } catch (error) {
        return error instanceof Error && /4000|uzun|karakter/i.test(error.message);
      }
    },
    Boolean,
  );
  await check(
    '20',
    'new document + description → edit → delete',
    'actual search sees addition/change/removal',
    async () => {
      const doc = await knowledge.create({
        title: 'Atlas çalışma odası',
        description: 'Atlas oda rezervasyonu',
        content: 'Atlas çalışma odası rezervasyon süresi 45 dakikadır.',
      });
      const created = await knowledge.search('Atlas çalışma odası rezervasyon süresi');
      await knowledge.update(doc.id, {
        title: doc.title,
        description: 'Atlas oda süre sınırı',
        content: 'Atlas çalışma odası rezervasyon süresi 75 dakikadır.',
        revision: doc.revision,
      });
      const edited = await knowledge.search('Atlas çalışma odası rezervasyon süresi');
      await knowledge.delete(doc.id);
      const deleted = await knowledge.search('Atlas çalışma odası rezervasyon süresi');
      return {
        created: created.filter((m) => m.documentId === doc.id).map((m) => m.content),
        edited: edited.filter((m) => m.documentId === doc.id).map((m) => m.content),
        deleted: deleted.filter((m) => m.documentId === doc.id),
      };
    },
    (r) =>
      r.created.some((s: string) => s.includes('45')) &&
      r.edited.some((s: string) => s.includes('75')) &&
      !r.edited.some((s: string) => s.includes('45')) &&
      r.deleted.length === 0,
  );
  if (llm.embeddingKey.startsWith('openai:')) {
    await check(
      '21',
      'real OpenAI → mock → real OpenAI',
      'foreign space excluded; real embeddings restored and retrievable',
      async () => {
        const mock = new KnowledgeService(db, new MockLLM(), {
          ...config,
          ...readConfig({}),
          DATABASE_URL: config.DATABASE_URL,
        });
        try {
          await mock.ensureIndex();
          const foreign = await knowledge.search('Yıllık izin kaç gün?');
          await knowledge.ensureIndex();
          const restored = await knowledge.search('Yıllık izin kaç gün?');
          return { foreign: foreign.length, restored: restored.map((m) => m.content) };
        } finally {
          await knowledge.ensureIndex();
        }
      },
      (r) => r.foreign === 0 && r.restored.some((s: string) => s.includes('20 iş günü')),
    );
  }
}
