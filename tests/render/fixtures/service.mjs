import http from 'node:http';
import { readFileSync, appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const config = JSON.parse(readFileSync('fixture.json', 'utf8'));
const record = (event) => appendFileSync(config.events, `${config.role}:${event}\n`);
if (config.crashAtStart) process.exit(1);
await delay(config.startDelay ?? 0);
const server = http.createServer(async (req, res) => {
  if (req.url === '/crash') process.exit(0);
  if (req.url === '/slow') {
    record('request');
    await delay(250);
  }
  if (req.url === '/inspect') {
    res.end(
      JSON.stringify({
        hasKey: !!process.env.OPENAI_API_KEY,
        hasDatabase: !!process.env.DATABASE_URL,
        hasCookieSecret: !!process.env.COOKIE_SECRET,
        backend: process.env.BACKEND_INTERNAL_URL,
      }),
    );
    return;
  }
  if (config.role === 'frontend') {
    const response = await fetch(`${process.env.BACKEND_INTERNAL_URL}/api/health/ready`);
    res.writeHead(response.status);
    res.end(await response.text());
  } else {
    res.writeHead(config.unhealthy ? 503 : 200);
    res.end('ready');
  }
});
server.listen(Number(process.env.PORT), process.env.BIND_HOST ?? process.env.HOSTNAME, () =>
  record('ready'),
);
process.on('SIGTERM', () => {
  record('term');
  if (config.ignoreTermination) return;
  server.close(() => {
    record('closed');
    process.exit(0);
  });
});
