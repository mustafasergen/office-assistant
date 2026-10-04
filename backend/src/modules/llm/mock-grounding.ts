import { SearchMatch } from './llm.types';
import { normalize, tokens } from './text';

// Limited Turkish inflections for evidence matching only. Embedding vocabulary and scores stay
// unchanged; every remaining content term must still be present in the retrieved source.
const evidenceAliases: Record<string, string> = {
  hakkim: 'hak',
  hakkimiz: 'hak',
  hakki: 'hak',
  odasini: 'oda',
  odasinda: 'oda',
  odalarinda: 'oda',
  gorusmelerini: 'gorusme',
  gorusmeler: 'gorusme',
  gorusmeleri: 'gorusme',
  gorusmesi: 'gorusme',
  yapabilirim: 'yap',
  yapilir: 'yap',
  yapilmaz: 'yap',
};
const questionGrammar = new Set(['nerede', 'nereye', 'ederim', 'edebilirim']);
function evidenceTerms(text: string): string[] {
  return tokens(text)
    .filter((term) => !questionGrammar.has(term))
    .map((term) => evidenceAliases[term] ?? term);
}

/** A deterministic mock must verify question terms, rather than equate topic similarity with an answer. */
export function groundedMockMatches(query: string, matches: SearchMatch[]): SearchMatch[] {
  const parts = query
    .split(/\s+ve\s+|[,;]/i)
    .filter((part) => !/^(?:ben )?(?:veganım|vejetaryenim)\s*$/iu.test(part.trim()));
  const picked: SearchMatch[] = [];
  for (const part of parts) {
    const terms = [...new Set(evidenceTerms(part))];
    if (!terms.length) continue;
    // Credential values are never inferred from instructions warning against sharing credentials.
    if (
      /\b(sifre|parola|anahtar)\b/.test(normalize(part)) &&
      /\b(nedir|kac|soyle)\b/.test(normalize(part))
    )
      continue;
    const locationQuestion = /\b(nerede|nereye)\b/.test(normalize(part));
    const ranked = matches
      // Removing a question word must not turn a nearby policy into a location answer.
      // Accept explicit positive place/action statements; a prohibition alone is insufficient.
      .filter(
        (match) =>
          !locationQuestion ||
          /\b[a-z]+(?:larinda|lerinde|inda|inde|unda|unde|indan|inden|dan|den)\b[^.!?]*\b(?:yapilir|bulunur|yer alir|rezerve edilir)\b/.test(
            normalize(match.content),
          ),
      )
      .map((match) => {
        const all = new Set(evidenceTerms(match.content));
        const headings = new Set(
          evidenceTerms(
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
  const terms = new Set(evidenceTerms(query));
  const sentences = match.content
    .split('\n')
    .filter((line) => !/^#/.test(line))
    .join(' ')
    .trim()
    .split(/(?<=[.!?])\s+/);
  // Procedures and locations need the surrounding sentences: a prohibition may be followed
  // by the permitted location. Do not present only the prohibition as the location answer.
  if (/\b(nasil|nerede|nereye|ne yapmaliyim|kurallari|kurallar)\b/.test(normalize(query)))
    return sentences.join(' ');
  const ranked = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: [...new Set(evidenceTerms(sentence))].filter((term) => terms.has(term)).length,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked[0]?.sentence ?? match.content;
}
