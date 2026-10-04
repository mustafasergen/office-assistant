import { gzipSync } from 'node:zlib';
/* eslint-disable @typescript-eslint/no-explicit-any -- serialized experiment grid has heterogeneous metrics. */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chunkDocument } from '../../src/modules/knowledge/chunking';
import { parseSeedDocument } from '../../src/modules/knowledge/seed-document';
import { hashEmbedding } from '../../src/modules/llm/text';
import { queries } from './corpus';
import { meteredClient, outputDir } from './support';
const norm = (v: number[]) => {
  const n = Math.hypot(...v);
  return n ? v.map((x) => x / n) : v;
};
const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);
async function main() {
  const live = process.env.EVAL_LIVE === '1';
  const client = live ? await meteredClient() : null;
  const dir = resolve(__dirname, '../../../fixtures/documents');
  const docs: ReturnType<typeof parseSeedDocument>[] = [];
  for (const slug of (await readdir(dir)).sort())
    docs.push(parseSeedDocument(await readFile(resolve(dir, slug), 'utf8'), slug));
  const synthetic =
    '# Bölge Avrupa\n\n## İş seyahati\n\n' +
    'Hazırlık belgeleri ekip tarafından incelenir. '.repeat(37) +
    'Konaklama sınırı gecelik 90 EUR olarak belirlenmiştir. ' +
    'Dönüşte belgeler teslim edilir. '.repeat(50);
  const layouts = [100, 200, 350].flatMap((size) =>
    [0, 30, 60].map((overlap) => ({
      size,
      overlap,
      chunks: docs.flatMap((d) =>
        chunkDocument(d.content, size, overlap).map((content) => ({
          content,
          title: d.title,
          description: d.description,
        })),
      ),
    })),
  );
  const inputs = [
    ...new Set([
      ...queries.map((q) => q.query),
      ...layouts.flatMap((l) =>
        l.chunks.flatMap((c) => [c.title + '\n' + c.content, c.title + '\n' + c.description]),
      ),
    ]),
  ];
  const output: any[] = [];
  const detail: any[] = [];
  for (const dimensions of [512, 768, 1536]) {
    const vectors = new Map<string, number[]>();
    if (client) {
      for (let i = 0; i < inputs.length; i += 100) {
        const batch = inputs.slice(i, i + 100);
        const response = await client.embeddings.create({
          model: 'text-embedding-3-small',
          input: batch,
          dimensions,
          encoding_format: 'float',
        });
        response.data.forEach((item) => vectors.set(batch[item.index], norm(item.embedding)));
      }
    } else inputs.forEach((text) => vectors.set(text, hashEmbedding(text, dimensions)));
    for (const layout of layouts)
      for (const weight of [0, 0.1, 0.25, 0.4]) {
        const chunks = layout.chunks.map((c) => {
          const v = vectors.get(c.title + '\n' + c.content)!;
          const meta = vectors.get(c.title + '\n' + c.description)!;
          return { ...c, vector: norm(v.map((x, i) => (1 - weight) * x + weight * meta[i])) };
        });
        const ranked = queries.map((q) => ({
          ...q,
          ranked: chunks
            .map((c) => ({ content: c.content, score: dot(vectors.get(q.query)!, c.vector) }))
            .sort((a, b) => b.score - a.score),
        }));
        for (const split of ['calibration', 'validation'])
          for (const k of [1, 3, 5])
            for (const threshold of [
              ...new Set([0.16, 0.3, ...Array.from({ length: 43 }, (_, i) => i * 0.02)]),
            ]) {
              let tp = 0,
                fp = 0,
                fn = 0,
                tn = 0,
                wrong = 0;
              for (const q of ranked.filter((q) => q.split === split)) {
                const matches = q.ranked.filter((m) => m.score >= threshold).slice(0, k);
                if (q.evidence.length) {
                  const good = q.evidence.every((e) => matches.some((m) => m.content.includes(e)));
                  tp += +good;
                  fn += +!good;
                  wrong += +(!!matches.length && !good);
                } else {
                  fp += +!!matches.length;
                  tn += +!matches.length;
                }
              }
              const precision = tp / (tp + fp + wrong) || 0,
                recall = tp / (tp + fn) || 0;
              output.push({
                dimensions,
                size: layout.size,
                overlap: layout.overlap,
                weight,
                split,
                k,
                threshold,
                tp,
                fp,
                fn,
                tn,
                wrong,
                precision,
                recall,
                f1: (2 * precision * recall) / (precision + recall) || 0,
                chunks: chunks.length,
              });
            }
        if (dimensions === 1536 && layout.size === 200 && layout.overlap === 30)
          detail.push({ weight, scores: ranked });
      }
  }
  const calibration = output.filter((r) => r.split === 'calibration');
  calibration.sort(
    (a, b) =>
      b.f1 - a.f1 ||
      a.fp - b.fp ||
      a.k - b.k ||
      b.dimensions - a.dimensions ||
      Math.abs(a.size - 200) - Math.abs(b.size - 200) ||
      Math.abs(a.overlap - 30) - Math.abs(b.overlap - 30),
  );
  const chosen = calibration[0];
  const validation = output.find(
    (r) =>
      r.split === 'validation' &&
      ['dimensions', 'size', 'overlap', 'weight', 'k', 'threshold'].every(
        (key) => r[key] === chosen[key],
      ),
  );
  const longLayouts = [100, 200, 350].flatMap((size) =>
    [0, 30, 60].map((overlap) => {
      const chunks = chunkDocument(synthetic, size, overlap);
      return {
        size,
        overlap,
        chunks: chunks.length,
        maxWords: Math.max(...chunks.map((c) => c.split(/\s+/).length)),
        answerPreserved: chunks.some((c) =>
          c.includes('Konaklama sınırı gecelik 90 EUR olarak belirlenmiştir.'),
        ),
        parentsPreserved: chunks.every(
          (c) => c.includes('Bölge Avrupa') && c.includes('İş seyahati'),
        ),
        storedWords: chunks.reduce((n, c) => n + c.split(/\s+/).length, 0),
      };
    }),
  );
  await writeFile(
    resolve(outputDir, `sweep-${live ? 'live' : 'mock'}.json.gz`),
    gzipSync(
      JSON.stringify(
        {
          selectedOnCalibration: chosen,
          validationAtSelected: validation,
          longLayouts,
          comparisons: output,
          detail,
        },
        null,
        2,
      ),
    ),
  );
  console.log(JSON.stringify({ live, chosen, validation, longLayouts }, null, 2));
}
main().catch((e) => {
  console.error(e.name);
  process.exitCode = 1;
});
