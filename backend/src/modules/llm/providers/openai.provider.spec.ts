import OpenAI from 'openai';
import { readConfig } from '../../../config/config';
import { OpenAIProvider } from './openai.provider';
import { ChatInput } from '../llm.types';

function setup() {
  const client = { responses: { create: jest.fn() }, embeddings: { create: jest.fn() } };
  const config = readConfig({
    LLM_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-only-not-real',
  });
  return { client, provider: new OpenAIProvider(config, client as unknown as OpenAI) };
}
const input: ChatInput = { currentMessage: 'İzin?', history: [], memories: [], toolResults: [] };
describe('OpenAIProvider contract', () => {
  it('preserves reasoning and call IDs when returning tool outputs', async () => {
    const { client, provider } = setup();
    client.responses.create
      .mockResolvedValueOnce({
        status: 'completed',
        output: [
          { type: 'reasoning', id: 'r1', summary: [] },
          {
            type: 'function_call',
            id: 'fc1',
            call_id: 'call1',
            name: 'search_docs',
            arguments: '{"query":"izin"}',
          },
        ],
      })
      .mockResolvedValueOnce({
        status: 'completed',
        output: [],
        output_text:
          '{"content":"20 gün","answerable":true,"memoryRecall":[],"evidence":[{"chunkId":"c1","quote":"20 gün"}]}',
      })
      .mockResolvedValueOnce({
        status: 'completed',
        output_text: '{"supported":true,"coverage":"answered"}',
      });
    const first = await provider.chat(input);
    if (first.kind !== 'tool_calls') throw new Error('Expected tool');
    const result = await provider.chat({
      ...input,
      state: first.state,
      toolResults: [
        {
          call: first.calls[0],
          output: {
            kind: 'search',
            matches: [
              { chunkId: 'c1', documentId: 'd1', title: 'İzin', content: '20 gün', score: 0.9 },
            ],
          },
        },
      ],
    });
    expect(result.kind).toBe('continue');
    if (result.kind !== 'continue') throw new Error('Expected evidence verification step');
    expect(await provider.chat({ ...input, state: result.state })).toEqual({
      kind: 'final',
      content: '20 gün',
      memoryRecall: [],
      citedChunkIds: ['c1'],
    });
    const sent = client.responses.create.mock.calls[1][0];
    expect(sent.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'reasoning', id: 'r1' }),
        expect.objectContaining({ type: 'function_call_output', call_id: 'call1' }),
      ]),
    );
    expect(sent.store).toBe(false);
  });
  it('drops a topically related answer when its evidence does not answer the actual question', async () => {
    const { client, provider } = setup();
    client.responses.create.mockResolvedValue({
      status: 'completed',
      output_text: '{"supported":true,"coverage":"unanswered"}',
    });
    const result = await provider.chat({
      ...input,
      currentMessage: 'Odanın kapasitesi kaç kişi?',
      state: {
        verification: true,
        candidate: {
          kind: 'final',
          content: 'Oda takvimden rezerve edilir.',
          citedChunkIds: ['c1'],
        },
        evidence: ['Oda takvimden rezerve edilir.'],
      },
    });
    expect(result).toMatchObject({ kind: 'final', citedChunkIds: [] });
    if (result.kind === 'final') expect(result.content).toContain('bulamadım');
  });
  it('does not cite a nearby policy when the final sentence admits the requested value is missing', async () => {
    const { client, provider } = setup();
    client.responses.create.mockResolvedValue({
      status: 'completed',
      output: [],
      output_text: JSON.stringify({
        content:
          'Parola destek mesajına eklenmez. VPN şifresi şirket belgelerinde paylaşılmamaktadır.',
        memoryRecall: [],
        answerable: true,
        evidence: [{ quote: 'Parola destek mesajına eklenmez.' }],
      }),
    });
    const result = await provider.chat({
      ...input,
      currentMessage: 'VPN şifresi nedir?',
      toolResults: [
        {
          call: { id: 's1', name: 'search_docs', arguments: { query: 'VPN şifresi nedir?' } },
          output: {
            kind: 'search',
            matches: [
              {
                chunkId: 'c1',
                documentId: 'd1',
                title: 'VPN',
                content: 'Parola destek mesajına eklenmez.',
                score: 0.8,
              },
            ],
          },
        },
      ],
    });
    expect(result).toMatchObject({ kind: 'final', citedChunkIds: [] });
  });
  it('does not offer save_memory for recall questions, even when a saved preference exists', async () => {
    const { client, provider } = setup();
    client.responses.create.mockResolvedValue({
      status: 'completed',
      output: [],
      output_text: '{"content":"Hatırlıyorum.","answerable":true,"memoryRecall":[],"evidence":[]}',
    });
    await provider.chat({
      ...input,
      currentMessage: 'Beslenme tercihim ne?',
      memories: [{ key: 'dietary_preference', value: 'vegetarian' }],
    });
    expect(
      client.responses.create.mock.calls[0][0].tools.map((tool: { name: string }) => tool.name),
    ).toEqual(['search_docs']);
  });
  it('passes semantic recall intent to the backend without treating history as a memory record', async () => {
    const { client, provider } = setup();
    client.responses.create.mockResolvedValue({
      status: 'completed',
      output: [],
      output_text: JSON.stringify({
        content: 'Vegan olarak kayıtlısınız.',
        memoryRecall: ['dietary_preference'],
        answerable: true,
        evidence: [],
      }),
    });
    const history = [{ role: 'user' as const, content: 'Veganım.' }];
    const result = await provider.chat({
      ...input,
      currentMessage: 'Beslenmeyle ilgili hafızanda bana ait ne var?',
      history,
    });
    expect(result).toMatchObject({
      kind: 'final',
      memoryRecall: ['dietary_preference'],
      citedChunkIds: [],
    });
    const sent = client.responses.create.mock.calls[0][0];
    expect(sent.input).toEqual(expect.arrayContaining(history));
    expect(sent.instructions).toContain('geçmişten tamamlamamalı');
    expect(sent.tools.map((tool: { name: string }) => tool.name)).not.toContain('save_memory');
  });
  it('requests 1536 dimensions and preserves embedding input order', async () => {
    const { client, provider } = setup();
    client.embeddings.create.mockResolvedValue({
      data: [
        { index: 1, embedding: Array(1536).fill(2) },
        { index: 0, embedding: Array(1536).fill(1) },
      ],
    });
    expect(await provider.embed(['a', 'b'])).toEqual([Array(1536).fill(1), Array(1536).fill(2)]);
    expect(client.embeddings.create.mock.calls[0][0]).toMatchObject({
      dimensions: 1536,
      model: 'text-embedding-3-small',
    });
  });
  it('does not fall back when the provider fails or truncates output', async () => {
    const { client, provider } = setup();
    client.responses.create
      .mockRejectedValueOnce(new Error('upstream unavailable'))
      .mockResolvedValueOnce({ status: 'incomplete' });
    await expect(provider.chat(input)).rejects.toThrow('upstream unavailable');
    await expect(provider.chat(input)).rejects.toThrow('tamamlanmış');
  });
  it.each([
    [{ index: 0, embedding: [1] }],
    [{ index: 0, embedding: Array(1536).fill(0) }],
    [{ index: 0, embedding: Array(1536).fill(NaN) }],
    [{ index: 1, embedding: Array(1536).fill(1) }],
    [],
  ])('rejects corrupt embedding output %#', async (...data) => {
    const { client, provider } = setup();
    client.embeddings.create.mockResolvedValue({ data });
    await expect(provider.embed(['text'])).rejects.toThrow('embedding');
  });
  it('rejects a fabricated quote even for a valid source ID', async () => {
    const { client, provider } = setup();
    client.responses.create.mockResolvedValue({
      status: 'completed',
      output: [],
      output_text: JSON.stringify({
        content: '900 gün',
        answerable: true,
        memoryRecall: [],
        evidence: [{ chunkId: 'c1', quote: '900 gün' }],
      }),
    });
    await expect(
      provider.chat({
        ...input,
        toolResults: [
          {
            call: { id: 't1', name: 'search_docs', arguments: {} },
            output: {
              kind: 'search',
              matches: [
                { chunkId: 'c1', documentId: 'd1', title: 'İzin', content: '20 gün', score: 0.8 },
              ],
            },
          },
        ],
      }),
    ).rejects.toThrow('kanıt');
  });
});
