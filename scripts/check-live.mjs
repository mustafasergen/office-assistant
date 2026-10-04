// Opt-in real API smoke check. Uses the running app; OpenAI mode incurs API charges.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
require('dotenv').config({ path: '.env', quiet: true });
const { createDataSource } = require('./dist/database/database.module');
const { readConfig } = require('./dist/config/config');
const db = createDataSource(readConfig());
const base = process.env.BASE_URL ?? 'http://localhost:3000';
let cookie = '';
let userId;
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(70000),
  });
  if (path === '/session') cookie = response.headers.get('set-cookie').split(';')[0];
  assert(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function send(thread, content) {
  return (await request(`/threads/${thread.id}/messages`, 'POST', { content })).assistantMessage;
}
try {
  await db.initialize();
  userId = (await request('/session', 'POST')).id;
  const first = await request('/threads', 'POST');
  const answer = await send(first, 'Vejetaryenim. Yıllık izin kaç iş günü?');
  assert.match(answer.content, /20/);
  assert(answer.metadata.tools.includes('save_memory'));
  assert(answer.metadata.tools.includes('search_docs'));
  assert(answer.metadata.sources.some((s) => s.title.toLocaleLowerCase('tr').includes('izin')));
  const source = await request(`/documents/${answer.metadata.sources[0].documentId}`);
  assert(source.content.includes('20'));
  const memories = await request('/memories');
  const preference = memories.find((m) => m.key === 'dietary_preference');
  assert.equal(preference?.value, 'vegetarian');
  const second = await request('/threads', 'POST');
  const recall = await send(second, 'Beslenme tercihim ne?');
  assert.match(recall.content.toLocaleLowerCase('tr'), /vejetaryen|vegetarian/);
  assert(!recall.metadata.tools.includes('save_memory'), 'Recall must not save memory again');
  await request(`/memories/${preference.id}`, 'DELETE');
  assert.equal(
    (await request('/memories')).length,
    0,
    'Deleted preference must disappear immediately',
  );
  const sameThread = await send(first, 'Beslenme tercihim ne?');
  assert.equal(sameThread.content, 'Beslenme tercihi bilgisi şu an hafızamda bulunmuyor.');
  assert(!sameThread.metadata.tools.includes('save_memory'));
  const third = await request('/threads', 'POST');
  const forgotten = await send(third, 'Kayıtlı beslenme tercihimi söyle.');
  assert.match(
    forgotten.content.toLocaleLowerCase('tr'),
    /bilinmiyor|hafızamda bulunmuyor/,
    'Unknown preference answer: ' + forgotten.content,
  );
  assert(
    !forgotten.metadata.tools.includes('save_memory'),
    'Unknown preference must not create memory',
  );
  const remaining = await request('/memories');
  assert.equal(
    remaining.length,
    0,
    JSON.stringify({
      remaining: remaining.map(({ key, value }) => ({ key, value })),
      answer: forgotten.content,
      tools: forgotten.metadata.tools,
    }),
  );
  console.log(
    JSON.stringify(
      {
        http: 'passed',
        provider: readConfig().LLM_PROVIDER,
        source: 'passed',
        tools: answer.metadata.tools,
        memorySave: 'passed',
        newThreadRecall: 'passed',
        memoryDelete: 'passed',
        sameThreadAfterDelete: 'passed',
        newThreadAfterDelete: 'passed',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message : error.name);
  process.exitCode = 1;
} finally {
  // Only remove the anonymous user created by this verification; cascade cleans its threads.
  if (userId && db.isInitialized) await db.query('DELETE FROM users WHERE id=$1', [userId]);
  if (db.isInitialized) await db.destroy();
}
