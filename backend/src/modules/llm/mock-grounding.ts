import { SearchMatch } from './llm.types';
import { normalize, tokens } from './text';

/** A deterministic mock must verify question terms, rather than equate topic similarity with an answer. */
export function groundedMockMatches(query: string, matches: SearchMatch[]): SearchMatch[] {
  const parts = query
    .split(/\s+ve\s+|[,;]/i)
    .filter((part) => !/^(?:ben )?(?:veganım|vejetaryenim)\s*$/iu.test(part.trim()));
  const picked: SearchMatch[] = [];
  for (const part of parts) {
    const terms = [...new Set(tokens(part))];
    if (!terms.length) continue;
    // Credential values are never inferred from instructions warning against sharing credentials.
    if (
      /\b(sifre|parola|anahtar)\b/.test(normalize(part)) &&
      /\b(nedir|kac|soyle)\b/.test(normalize(part))
    )
      continue;
    const ranked = matches
      .map((match) => {
        const all = new Set(tokens(match.content));
        const headings = new Set(
          tokens(
            match.content
              .split('\n')
              .filter((line) => /^#/.test(line))
              .join(' '),
          ),
        );
        const covered = terms.filter((term) => all.has(term)).length;
        return {
          match,
          covered,
          rank:
            covered / terms.length +
            terms.filter((term) => headings.has(term)).length * 0.05 +
            match.score * 0.01,
        };
      })
      .filter((item) => item.covered === terms.length)
      .sort((a, b) => b.rank - a.rank);
    if (ranked[0] && !picked.some((item) => item.chunkId === ranked[0].match.chunkId))
      picked.push(ranked[0].match);
  }
  return picked;
}

/** Return the sentence addressing the requested detail; the citation still contains the full context. */
export function focusedMockAnswer(query: string, match: SearchMatch): string {
  const terms = new Set(tokens(query));
  const sentences = match.content
    .split('\n')
    .filter((line) => !/^#/.test(line))
    .join(' ')
    .trim()
    .split(/(?<=[.!?])\s+/);
  // Procedure/rules questions need the ordered steps, not just the highest-scoring sentence.
  if (/\b(nasil|ne yapmaliyim|kurallari|kurallar)\b/.test(normalize(query)))
    return sentences.join(' ');
  const ranked = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: [...new Set(tokens(sentence))].filter((term) => terms.has(term)).length,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked[0]?.sentence ?? match.content;
}
