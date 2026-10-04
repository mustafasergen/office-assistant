import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { supportsAnswer } from './answer-oracle';
import { queries } from './corpus';
import { Result, saveReport, outputDir } from './support';

async function main() {
  for (const provider of ['mock', 'live']) {
    const original = JSON.parse(
      await readFile(resolve(outputDir, `baseline-${provider}.json`), 'utf8'),
    );
    const results: Result[] = original.results.map((row: Result) => {
      const question = queries.find((q) => q.query === row.input);
      if (!question?.evidence.length) return row;
      const actual = row.actual as {
        content?: string;
        metadata?: { sources?: { excerpt: string }[] };
      };
      return {
        ...row,
        pass:
          !!actual.content &&
          question.evidence.every(
            (evidence) =>
              supportsAnswer(actual.content!, evidence) &&
              actual.metadata?.sources?.some((s) => s.excerpt.includes(evidence)),
          ),
      };
    });
    await saveReport(`baseline-reviewed-${provider}`, results, {
      note: 'Same original outputs, reviewed with the final semantic wording oracle. No API calls. Original reports retained.',
    });
  }
  // This script audits known baseline failures; they do not mean the review script failed.
  process.exitCode = 0;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
