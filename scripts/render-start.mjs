import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout, clearTimeout } from 'node:timers';

/** PID 1 owns both processes. Configuration parameters also allow real-process lifecycle tests. */
export async function runServices({
  root = '/app',
  env = process.env,
  backendPort = 3001,
  startupTimeoutMs = 300_000,
  shutdownTimeoutMs = 80_000,
  probeIntervalMs = 500,
} = {}) {
  const port = Number(env.PORT ?? 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === backendPort)
    throw new Error('PORT must be a valid port other than the internal backend port 3001.');
  if (!env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required for the Render image.');
  if (!env.COOKIE_SECRET || env.COOKIE_SECRET.length < 24)
    throw new Error('COOKIE_SECRET must contain at least 24 characters.');

  const children = new Map();
  const boot = new globalThis.AbortController();
  let stopping = false;
  let finish;
  const completed = new Promise((resolve) => {
    finish = resolve;
  });
  const log = (message) => console.log(`[services] ${message}`);
  const signalChild = (child, signal) => {
    if (!child?.process.pid) return;
    try {
      // Separate process groups also terminate any descendants on forced shutdown.
      process.kill(-child.process.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  async function stop(code, graceful) {
    if (stopping) return;
    stopping = true;
    boot.abort();
    let forced = false;
    const timeout = setTimeout(() => {
      forced = true;
      log('Shutdown deadline exceeded; terminating remaining process groups.');
      for (const child of children.values()) signalChild(child, 'SIGKILL');
    }, shutdownTimeoutMs);
    if (graceful) {
      // Backend stays available while Next drains its in-flight proxy requests.
      for (const name of ['frontend', 'backend']) {
        const child = children.get(name);
        signalChild(child, 'SIGTERM');
        await child?.done;
      }
    } else {
      for (const child of children.values()) signalChild(child, 'SIGTERM');
      await Promise.all([...children.values()].map((child) => child.done));
    }
    clearTimeout(timeout);
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    finish(forced ? 1 : code);
  }
  const onSignal = () => {
    void stop(0, true);
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  function launch(name, cwd, file, childEnv) {
    const child = {
      process: spawn(process.execPath, [file], {
        cwd,
        env: childEnv,
        stdio: 'inherit',
        detached: true,
      }),
    };
    children.set(name, child);
    child.done = new Promise((resolve) => {
      child.process.once('error', () => {
        log(`${name} could not start.`);
        resolve();
        void stop(1, false);
      });
      child.process.once('exit', (code, signal) => {
        log(`${name} exited (code=${code}, signal=${signal}).`);
        resolve();
        if (!stopping) void stop(1, false); // Even an unexpected clean exit is a service failure.
      });
    });
  }
  try {
    launch('backend', resolve(root, 'backend-app/backend'), 'dist/main.js', {
      ...env,
      PORT: String(backendPort),
      BIND_HOST: '127.0.0.1',
      NODE_ENV: 'production',
    });
    const deadline = Date.now() + startupTimeoutMs;
    let ready = false;
    while (!stopping && Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${backendPort}/api/health/ready`, {
          signal: AbortSignal.any([boot.signal, AbortSignal.timeout(2000)]),
        });
        ready = response.ok;
        await response.body?.cancel();
        if (ready) break;
      } catch {
        /* Backend has not finished migrations/seed/index yet. */
      }
      await delay(probeIntervalMs, undefined, { signal: boot.signal });
    }
    if (!stopping && !ready) throw new Error('Backend readiness deadline exceeded.');
    if (!stopping) {
      log('Backend ready; starting frontend.');
      // No database credentials, API keys or cookie-signing secret in the Next process.
      launch('frontend', resolve(root, 'web'), 'frontend/server.js', {
        PATH: env.PATH,
        HOME: env.HOME,
        TZ: env.TZ,
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        HOSTNAME: '0.0.0.0',
        PORT: String(port),
        BACKEND_INTERNAL_URL: `http://127.0.0.1:${backendPort}`,
      });
    }
  } catch (error) {
    if (!stopping) {
      // Do not log child environment, database URLs or credential-bearing errors.
      log(
        error.message === 'Backend readiness deadline exceeded.'
          ? error.message
          : 'Startup failed.',
      );
      void stop(1, false);
    }
  }
  return completed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runServices()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[services] ${error.message}`);
      process.exitCode = 1;
    });
}
