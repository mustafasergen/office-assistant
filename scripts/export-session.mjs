import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

// Export exactly one selected session. Never enumerate or export unrelated conversations.
const source = process.argv[2];
if (!source || !source.endsWith('.jsonl'))
  throw new Error('Usage: node scripts/export-session.mjs /absolute/path/to/case-session.jsonl');
let raw = await readFile(source, 'utf8');
const env = await readFile(resolve('.env'), 'utf8').catch(() => '');
const secrets = env.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*([A-Z_]*(?:API_KEY|TOKEN|SECRET|PASSWORD))\s*=\s*(.*?)\s*$/);
  if (!match) return [];
  const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
  return value.length >= 12 && !value.startsWith('uplico-local-demo-') ? [value] : [];
});
const databaseUrl = env.match(/^DATABASE_URL=(.*)$/m)?.[1];
if (databaseUrl) {
  const password = new URL(databaseUrl).password;
  if (password.length >= 8) secrets.push(password, decodeURIComponent(password));
}
for (const secret of secrets) raw = raw.split(secret).join('[REDACTED]');
raw = raw.replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]');
// Validate without reserializing: ordering, whitespace and all non-secret content stay intact.
for (const line of raw.split('\n')) if (line.trim()) JSON.parse(line);
await mkdir('delivery', { recursive: true });
const destination = resolve('delivery', basename(source));
await writeFile(destination, raw, { mode: 0o600 });
console.log(`Session snapshot exported: ${destination}`);
console.log('Review for any other secrets before sharing. Repeat after the final interaction.');
