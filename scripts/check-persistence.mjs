import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const docker = process.env.DOCKER_BIN ?? 'docker';
let cookie;
async function api(path, body) {
  const response = await fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert(response.ok, `${path}: HTTP ${response.status}`);
  if (path === '/session') cookie = response.headers.getSetCookie()[0].split(';')[0];
  return response.json();
}
await api('/session', {});
const thread = await api('/threads', {});
await api(`/threads/${thread.id}/messages`, { content: 'Vejetaryenim' });
const memories = await api('/memories');
const sources = await api('/documents');
execFileSync(docker, ['compose', 'restart', 'postgres', 'backend', 'frontend'], {
  stdio: 'inherit',
});
const deadline = Date.now() + 90000;
while (true) {
  try {
    await api('/health/ready');
    break;
  } catch (error) {
    if (Date.now() > deadline) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
assert.deepEqual(await api('/memories'), memories);
assert.deepEqual(await api('/documents'), sources);
assert.equal((await api(`/threads/${thread.id}/messages`)).length, 2);
console.log(
  'PASS: cookie identity, messages, memory and seeded documents survived container restart.',
);
