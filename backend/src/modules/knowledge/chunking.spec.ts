import { chunkDocument } from './chunking';
describe('chunking', () => {
  it('retains section headings and paragraphs without indexing an empty title', () => {
    expect(
      chunkDocument(
        '# Şirket\n\n## İzin\n\n20 gün izin.\n\nTalep yöneticiye.\n\n## Yemek\n\nKart limiti 350 TL.',
      ),
    ).toEqual([
      '# Şirket\n## İzin\n\n20 gün izin.\n\nTalep yöneticiye.',
      '# Şirket\n## Yemek\n\nKart limiti 350 TL.',
    ]);
  });
  it('overlaps long paragraphs and preserves the final words', () => {
    const words = Array.from({ length: 450 }, (_, i) => `kelime${i}`);
    const chunks = chunkDocument(words.join(' '));
    expect(chunks).toHaveLength(3);
    expect(chunks[0].split(' ').slice(-30)).toEqual(chunks[1].split(' ').slice(0, 30));
    expect(chunks.at(-1)?.endsWith('kelime449')).toBe(true);
  });
  it('handles empty input and rejects invalid overlap', () => {
    expect(chunkDocument(' \n ')).toEqual([]);
    expect(() => chunkDocument('text', 20, 30)).toThrow();
  });
});
