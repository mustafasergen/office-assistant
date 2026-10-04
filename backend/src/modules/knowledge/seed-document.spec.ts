import { parseSeedDocument } from './seed-document';
import { chunkDocument } from './chunking';

describe('seed document metadata', () => {
  it('extracts the library description without adding a metadata-only source chunk', () => {
    const parsed = parseSeedDocument(
      '# Rehber\r\n\r\n> Kısa arama açıklaması\r\n\r\n## Kural\r\n\r\nAsıl kaynak bilgisi.',
      'guide.md',
    );
    expect(parsed.title).toBe('Rehber');
    expect(parsed.description).toBe('Kısa arama açıklaması');
    expect(chunkDocument(parsed.content)).toEqual(['# Rehber\n## Kural\n\nAsıl kaynak bilgisi.']);
  });
  it('preserves ordinary blockquotes and supports files without metadata', () => {
    const content = '# Rehber\n\n## Kural\n\n> Kaynaktaki alıntı';
    expect(parseSeedDocument(content, 'guide.md')).toEqual({
      title: 'Rehber',
      description: '',
      content,
    });
    expect(parseSeedDocument('Düz metin.', 'guide.txt').title).toBe('guide.txt');
  });
});
