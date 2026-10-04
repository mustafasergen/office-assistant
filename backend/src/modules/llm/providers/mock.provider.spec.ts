import { MockLLM } from './mock.provider';
import { extractMemoryFacts as extractFacts } from '../../memory/facts';
import { ChatInput } from '../llm.types';
import { hashEmbedding, normalize } from '../text';

const input: ChatInput = {
  currentMessage: 'Vejetaryenim, yemek seçenekleri neler?',
  history: [],
  memories: [],
  toolResults: [],
};
describe('MockLLM', () => {
  const model = new MockLLM();
  it('deterministically saves memory, searches, then answers from tool output', async () => {
    const first = await model.chat(input);
    expect(first).toEqual(await model.chat(input));
    expect(first.kind).toBe('tool_calls');
    if (first.kind !== 'tool_calls') throw new Error('Expected tool call');
    expect(first.calls[0].name).toBe('save_memory');
    const afterSave: ChatInput = {
      ...input,
      toolResults: [
        {
          call: first.calls[0],
          output: {
            kind: 'memory',
            key: 'dietary_preference',
            value: 'vegetarian',
            status: 'created',
          },
        },
      ],
    };
    const second = await model.chat(afterSave);
    if (second.kind !== 'tool_calls') throw new Error('Expected search');
    expect(second.calls[0].name).toBe('search_docs');
    const final = await model.chat({
      ...afterSave,
      toolResults: [
        ...afterSave.toolResults,
        {
          call: second.calls[0],
          output: {
            kind: 'search',
            matches: [
              {
                chunkId: 'chunk',
                documentId: 'doc',
                title: 'Menü',
                content: 'Her gün sebzeli menü sunulur.',
                score: 0.9,
              },
            ],
          },
        },
      ],
    });
    expect(final).toMatchObject({ kind: 'final', citedChunkIds: ['chunk'] });
    if (final.kind === 'final') expect(final.content).toContain('Her gün sebzeli menü sunulur.');
  });
  it('does not turn negation into a vegetarian preference', () => {
    expect(extractFacts('Vejetaryen değilim.')).toEqual([]);
    expect(extractFacts('Beslenme kısıtlamam yok.')).toEqual([
      { key: 'dietary_preference', value: 'no_restriction' },
    ]);
    expect(extractFacts('Adım Deniz.')).toEqual([{ key: 'name', value: 'Deniz' }]);
    expect(extractFacts('Yazılım departmanında çalışıyorum.')).toEqual([
      { key: 'department', value: 'Yazılım' },
    ]);
  });
  it('never re-extracts deleted facts from past messages', async () => {
    const response = await model.chat({
      ...input,
      currentMessage: 'Merhaba',
      history: [{ role: 'user', content: 'Vejetaryenim' }],
    });
    expect(response.kind).toBe('final');
  });
  it('produces stable, normalized 1536-dimensional embeddings and handles Turkish casing', () => {
    const vector = hashEmbedding('YILLIK İZİN');
    expect(vector).toEqual(hashEmbedding('yıllık izin'));
    expect(vector).toHaveLength(1536);
    expect(Math.hypot(...vector)).toBeCloseTo(1);
    expect(normalize('İŞ IŞIK')).toBe('is isik');
    expect(hashEmbedding('!?')).toEqual(Array(1536).fill(0));
  });
  it('does not invent facts when retrieval is empty', async () => {
    const response = await model.chat({
      ...input,
      currentMessage: 'Mars kaç kilometre?',
      toolResults: [
        {
          call: { id: '1', name: 'search_docs', arguments: {} },
          output: { kind: 'search', matches: [] },
        },
      ],
    });
    expect(response).toMatchObject({ kind: 'final', citedChunkIds: [] });
    if (response.kind === 'final') expect(response.content).toContain('bulamadım');
  });
});
