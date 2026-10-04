import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { collectText, secretCandidates, redact } from './session-redaction.mjs';

const [source, expectedId, destination, extraSecretsFile] = process.argv.slice(2);
if (!source?.endsWith('.jsonl') || !expectedId || !destination?.endsWith('.jsonl'))
  throw new Error(
    'Usage: node scripts/export-session.mjs SOURCE SESSION_ID DESTINATION [PRIVATE_SECRET_LIST_JSON]',
  );
if (resolve(source) === resolve(destination))
  throw new Error('Never overwrite the original session.');
const snapshot = await readFile(source, 'utf8');
const raw = snapshot.slice(0, snapshot.lastIndexOf('\n') + 1);
const records = raw
  .trimEnd()
  .split('\n')
  .map((line) => JSON.parse(line));
if (records[0]?.type !== 'session_meta' || records[0].payload.id !== expectedId)
  throw new Error('Selected session identity does not match.');
const env = await readFile('.env', 'utf8').catch(() => '');
const extra = extraSecretsFile ? JSON.parse(await readFile(extraSecretsFile, 'utf8')) : [];
const configuredSecrets = env.split(/\r?\n/).flatMap((line) => {
  const match = line.match(
    /^\s*(?:#\s*)?([A-Z_]*(?:API_KEY|TOKEN|SECRET|PASSWORD))\s*=\s*(.*?)\s*$/,
  );
  if (!match) return [];
  const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
  return value.length >= 8 && !/[<>$]/.test(value) ? [value] : [];
});
const secrets = [...secretCandidates([...collectText(raw), env]), ...configuredSecrets, ...extra];
const { output, replacements } = redact(raw, secrets);
const sha = (value) => createHash('sha256').update(value).digest('hex');
// The source can grow during export. Its already-read prefix must remain unchanged.
const current = await readFile(source);
if (sha(current.subarray(0, Buffer.byteLength(raw))) !== sha(raw))
  throw new Error('Source prefix changed.');
await mkdir(dirname(resolve(destination)), { recursive: true });
await writeFile(destination, output, { mode: 0o600 });
const metadata = {
  sessionId: expectedId,
  capturedAt: new Date().toISOString(),
  firstRecordAt: records[0].timestamp,
  lastRecordAt: records.at(-1).timestamp,
  records: records.length,
  sourcePrefixBytes: Buffer.byteLength(raw),
  sourcePrefixSha256: sha(raw),
  exportedBytes: Buffer.byteLength(output),
  exportedSha256: sha(output),
  replacements,
  sourcePrefixUnchanged: true,
  transformation:
    'Only literal credential replacements; original JSONL formatting and record order preserved.',
};
await writeFile(
  destination.replace(/\.jsonl$/, '.metadata.json'),
  JSON.stringify(metadata, null, 2) + '\n',
);
console.log(JSON.stringify(metadata));
