/** Quoting a clause may replace its trailing semicolon with a period. Words/numbers must stay exact. */
export function containsEvidence(source: string, quote: string): boolean {
  const sentences = quote.split(/(?<=[.!?])\s+(?=\p{Lu})/u);
  if (sentences.length > 1)
    return sentences.every((sentence) => containsEvidence(source, sentence));
  const compact = (text: string) =>
    text.normalize('NFC').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
  const haystack = compact(source);
  const needle = compact(quote)
    .replace(/[.!?;…]+$/u, '')
    .trim();
  if (!needle) return false;
  let offset = haystack.indexOf(needle);
  while (offset !== -1) {
    const before = haystack[offset - 1] ?? '';
    const after = haystack[offset + needle.length] ?? '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    offset = haystack.indexOf(needle, offset + 1);
  }
  return false;
}
