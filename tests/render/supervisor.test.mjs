import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function fixture(t, backend = {}, frontend = {}, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'office-supervisor-'));
  const events = join(root, 'events');
  const port = await freePort();
  const backendPort = await freePort();
  for (const [role, dir, file, settings] of [
    ['backend', 'backend-app/backend', 'dist/main.js', backend],
    ['frontend', 'web', 'frontend/server.js', frontend],
  ]) {
    await mkdir(join(root, dir, file, '..'), { recursive: true });
    await writeFile(join(root, dir, 'package.json'), '{"type":"module"}');
    await writeFile(join(root, dir, 'fixture.json'), JSON.stringify({ role, events, ...settings }));
    await copyFile(new URL('./fixtures/service.mjs', import.meta.url), join(root, dir, file));
  }
  const module = pathToFileURL(resolve('scripts/render-start.mjs')).href;
  const params = {
    root,
    backendPort,
    startupTimeoutMs: 4000,
    shutdownTimeoutMs: 1500,
    probeIntervalMs: 20,
    ...options,
  };
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {runServices} from ${JSON.stringify(module)}; process.exitCode = await runServices(${JSON.stringify(params)});`,
    ],
    {
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL: 'postgresql://test:test@unused/test',
        COOKIE_SECRET: 'test-secret-at-least-24-characters',
        OPENAI_API_KEY: 'test-not-a-real-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (s) => {
    output += s;
  });
  child.stderr.on('data', (s) => {
    output += s;
  });
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
    await rm(root, { recursive: true, force: true });
  });
  async function waitFor(check) {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (await check()) return;
      if (child.exitCode !== null) throw new Error(`Exited early: ${output}`);
      await delay(20);
    }
    throw new Error(`Timed out: ${output}`);
  }
  const eventText = () => readFile(events, 'utf8').catch(() => '');
  return {
    child,
    exited,
    eventText,
    waitFor,
    port,
    backendPort,
    output: () => output,
    ready: () => waitFor(async () => (await eventText()).includes('frontend:ready')),
    request: (path) => fetch(`http://127.0.0.1:${port}${path}`),
  };
}

test('starts frontend only after backend readiness and keeps secrets out of frontend', async (t) => {
  const f = await fixture(t, { startDelay: 200 });
  await f.ready();
  const events = await f.eventText();
  assert(events.indexOf('backend:ready') < events.indexOf('frontend:ready'));
  assert.equal((await f.request('/api/health/ready')).status, 200);
  assert.deepEqual(await (await f.request('/inspect')).json(), {
    hasKey: false,
    hasDatabase: false,
    hasCookieSecret: false,
    backend: `http://127.0.0.1:${f.backendPort}`,
  });
});
test('drains frontend requests before closing backend on SIGTERM', async (t) => {
  // Node may retain a just-completed in-flight connection for its 5s keep-alive interval.
  const f = await fixture(t, {}, {}, { shutdownTimeoutMs: 10_000 });
  await f.ready();
  const pending = f.request('/slow');
  await f.waitFor(async () => (await f.eventText()).includes('frontend:request'));
  f.child.kill('SIGTERM');
  assert.equal(await (await pending).text(), 'ready');
  assert.equal((await f.exited).code, 0, f.output());
  const events = await f.eventText();
  assert(events.indexOf('frontend:closed') < events.indexOf('backend:term'));
});
for (const side of ['backend', 'frontend'])
  test(`${side} crash stops its peer and exits nonzero`, async (t) => {
    const f = await fixture(t);
    await f.ready();
    const port = side === 'frontend' ? f.port : f.backendPort;
    await fetch(`http://127.0.0.1:${port}/crash`).catch(() => {});
    assert.equal((await f.exited).code, 1);
    assert(
      (await f.eventText()).includes(`${side === 'frontend' ? 'backend' : 'frontend'}:closed`),
    );
  });
test('backend startup failure never starts frontend', async (t) => {
  const f = await fixture(t, { crashAtStart: true });
  assert.equal((await f.exited).code, 1);
  assert(!(await f.eventText()).includes('frontend:ready'));
});
test('readiness timeout stops backend and fails the container', async (t) => {
  const f = await fixture(t, { unhealthy: true }, {}, { startupTimeoutMs: 400 });
  assert.equal((await f.exited).code, 1);
  assert.match(f.output(), /readiness deadline exceeded/);
  assert(!(await f.eventText()).includes('frontend:ready'));
});
test('forces termination when a child ignores SIGTERM', async (t) => {
  const f = await fixture(t, {}, { ignoreTermination: true }, { shutdownTimeoutMs: 300 });
  await f.ready();
  f.child.kill('SIGTERM');
  assert.equal((await f.exited).code, 1);
  assert.match(f.output(), /Shutdown deadline exceeded/);
});
test('SIGTERM during startup prevents frontend launch', async (t) => {
  const f = await fixture(t, { unhealthy: true });
  await f.waitFor(async () => (await f.eventText()).includes('backend:ready'));
  f.child.kill('SIGTERM');
  assert.equal((await f.exited).code, 0);
  assert(!(await f.eventText()).includes('frontend:ready'));
});
