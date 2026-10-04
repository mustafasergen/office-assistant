import { CHUNK_DEFAULTS } from '../../config/defaults';
export const CHUNKER_VERSION = 'hierarchy-200-overlap30-v2';

/** Include ancestor headings in every chunk and count them in the word budget. */
export function chunkDocument(
  content: string,
  maxWords = CHUNK_DEFAULTS.maxWords,
  overlap = CHUNK_DEFAULTS.overlap,
): string[] {
  if (
    !Number.isInteger(maxWords) ||
    !Number.isInteger(overlap) ||
    maxWords <= overlap ||
    overlap < 0
  )
    throw new Error('Chunk boyutu overlap değerinden büyük olmalı.');
  const chunks: string[] = [];
  const headings: { level: number; text: string }[] = [];
  let body: string[] = [];
  const flush = () => {
    const paragraphs = body
      .join('\n')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    body = [];
    if (!paragraphs.length) return;
    const header = headings.map((h) => h.text).join('\n');
    const headerWords = header ? header.split(/\s+/).length : 0;
    const capacity = maxWords - headerWords;
    if (capacity <= overlap) throw new Error('Başlık bağlamı chunk boyutuna sığmıyor.');
    if (paragraphs.join(' ').split(/\s+/).length <= capacity) {
      chunks.push([header, paragraphs.join('\n\n')].filter(Boolean).join('\n\n'));
      return;
    }
    let words: string[] = [];
    for (const paragraph of paragraphs) {
      const next = paragraph.split(/\s+/);
      if (words.length && words.length + next.length > capacity) {
        chunks.push([header, words.join(' ')].filter(Boolean).join('\n\n'));
        words = overlap ? words.slice(-overlap) : [];
      }
      words.push(...next);
      while (words.length > capacity) {
        chunks.push([header, words.slice(0, capacity).join(' ')].filter(Boolean).join('\n\n'));
        words = words.slice(capacity - overlap);
      }
    }
    if (words.length) chunks.push([header, words.join(' ')].filter(Boolean).join('\n\n'));
  };
  for (const line of content.replace(/\r\n/g, '\n').trim().split('\n')) {
    const heading = line.match(/^(#{1,6})\s+\S/);
    if (!heading) {
      body.push(line);
      continue;
    }
    flush();
    const level = heading[1].length;
    while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
    headings.push({ level, text: line.trim() });
  }
  flush();
  return chunks;
}
