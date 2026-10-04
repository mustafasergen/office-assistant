import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
export const outputDir = resolve(__dirname, '../../../docs/evaluation');
export const privateDir = '/private/tmp/uplico-evaluation-20261003';
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export interface Result {
  group: string;
  input: unknown;
  expected: unknown;
  actual: unknown;
  pass: boolean;
  environment: string;
}
export async function saveReport(name: string, rows: Result[], extra: unknown = {}) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    resolve(outputDir, name + '.json'),
    JSON.stringify({ at: new Date().toISOString(), results: rows, extra }, null, 2),
  );
  const cell = (value: unknown) =>
    JSON.stringify(value).replaceAll('|', '\\|').replaceAll('\n', ' ').slice(0, 2500);
  await writeFile(
    resolve(outputDir, name + '.md'),
    '# ' +
      name +
      '\n\n| Grup | Ortam | Girdi | Beklenen | Gerçek | Sonuç |\n|---|---|---|---|---|---|\n' +
      rows
        .map(
          (r) =>
            `| ${r.group} | ${r.environment} | ${cell(r.input)} | ${cell(r.expected)} | ${cell(r.actual)} | ${r.pass ? 'GEÇTİ' : 'KALDI'} |`,
        )
        .join('\n') +
      '\n',
  );
  console.log(
    JSON.stringify({
      report: name,
      passed: rows.filter((r) => r.pass).length,
      failed: rows.filter((r) => !r.pass).length,
    }),
  );
  if (rows.some((row) => !row.pass)) process.exitCode = 1;
}
interface Ledger {
  spent: number;
  reserved: number;
  calls: { kind: string; input: number; output: number; cost: number; error?: boolean }[];
}
export async function meteredClient() {
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const path = resolve(privateDir, 'cost.json');
  const ledger: Ledger = await readFile(path, 'utf8')
    .then(JSON.parse)
    .catch(() => ({ spent: 0, reserved: 0, calls: [] }));
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 30000 });
  const persist = () => writeFile(path, JSON.stringify(ledger, null, 2), { mode: 0o600 });
  const reserve = async (kind: string, input: number, output = 0) => {
    const cost = (input * (kind === 'embed' ? 0.02 : 0.4) + output * 1.6) / 1e6;
    if (ledger.spent + ledger.reserved + cost > 2)
      throw new Error('Approved $2 API budget exhausted');
    ledger.reserved += cost;
    await persist();
    return cost;
  };
  const settle = async (
    kind: string,
    reserved: number,
    input: number,
    output: number,
    error = false,
  ) => {
    const cost = error ? reserved : (input * (kind === 'embed' ? 0.02 : 0.4) + output * 1.6) / 1e6;
    ledger.reserved -= reserved;
    ledger.spent += cost;
    ledger.calls.push({ kind, input, output, cost, error });
    await persist();
  };
  const embed = client.embeddings.create.bind(client.embeddings);
  client.embeddings.create = (async (body: OpenAI.EmbeddingCreateParams, options?: unknown) => {
    const key = sha(JSON.stringify(body));
    const file = resolve(privateDir, key + '.json');
    const cached = await readFile(file, 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    if (cached) return cached;
    const reserved = await reserve('embed', Buffer.byteLength(JSON.stringify(body)) + 256);
    try {
      const res = await embed(body, options as never);
      await settle('embed', reserved, res.usage.total_tokens, 0);
      await writeFile(file, JSON.stringify(res), { mode: 0o600 });
      return res;
    } catch (e) {
      await settle('embed', reserved, 0, 0, true);
      throw e;
    }
  }) as typeof client.embeddings.create;
  const chat = client.responses.create.bind(client.responses);
  client.responses.create = (async (
    body: OpenAI.Responses.ResponseCreateParamsNonStreaming,
    options?: unknown,
  ) => {
    const reserved = await reserve(
      'chat',
      Buffer.byteLength(JSON.stringify(body)) + 2048,
      body.max_output_tokens ?? 1600,
    );
    try {
      const res = await chat(body, options as never);
      await settle('chat', reserved, res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
      await writeFile(
        resolve(privateDir, `chat-${ledger.calls.length}.json`),
        JSON.stringify({ input: body.input, response: res }),
        { mode: 0o600 },
      );
      return res;
    } catch (e) {
      await settle('chat', reserved, 0, 0, true);
      throw e;
    }
  }) as typeof client.responses.create;
  return client;
}
