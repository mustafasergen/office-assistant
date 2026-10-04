import { AgentService, AgentInput } from './agent.service';
import { type LLMProvider } from '../llm/llm.types';
import { SearchDocsTool } from './tools/search-docs.tool';
import { SaveMemoryTool } from './tools/save-memory.tool';
import { readConfig } from '../../config/config';

const input: AgentInput = {
  userId: 'u',
  messageId: 'm',
  currentMessage: 'İzin kaç gün?',
  history: [],
  memories: [],
};
function setup() {
  const llm = { embeddingKey: 'test', chat: jest.fn(), embed: jest.fn() } satisfies LLMProvider;
  const search = {
    execute: jest.fn().mockResolvedValue({
      kind: 'search',
      matches: [{ chunkId: 'c1', documentId: 'd1', title: 'İzin', content: '20 gün', score: 0.9 }],
    }),
  };
  const memory = {
    execute: jest.fn().mockResolvedValue({
      kind: 'memory',
      key: 'dietary_preference',
      value: 'vegetarian',
      status: 'created',
    }),
  };
  const config = readConfig({});
  return {
    llm,
    search,
    memory,
    config,
    agent: new AgentService(
      llm,
      search as unknown as SearchDocsTool,
      memory as unknown as SaveMemoryTool,
      config,
    ),
  };
}
describe('agent tool loop', () => {
  it.each(['Beslenme tercihim ne?', 'Belenme tercihim ne?', 'Adım ne?', 'Departmanım ne?'])(
    'does not let stale history/model claims override missing memory: %s',
    async (question) => {
      const { llm, agent, memory } = setup();
      llm.chat.mockResolvedValue({
        kind: 'final',
        content: 'Vegan olarak kayıtlısınız.',
        citedChunkIds: [],
      });
      const result = await agent.run({
        ...input,
        currentMessage: question,
        history: [
          { role: 'user', content: 'Veganım. Adım Deniz. Yazılım departmanında çalışıyorum.' },
          { role: 'assistant', content: 'Bilgilerini hafızama kaydettim.' },
        ],
      });
      expect(result.content).toContain('şu an hafızamda bulunmuyor');
      expect(result.content).not.toMatch(/vegan|Deniz|Yazılım/);
      expect(result.sources).toEqual([]);
      expect(memory.execute).not.toHaveBeenCalled();
    },
  );
  it('does not let a document citation stand in for a deleted personal preference', async () => {
    const { llm, agent } = setup();
    llm.chat
      .mockResolvedValueOnce({
        kind: 'tool_calls',
        calls: [{ id: 's1', name: 'search_docs', arguments: { query: 'vegan' } }],
      })
      .mockResolvedValueOnce({
        kind: 'final',
        content: 'Vegan olarak kayıtlısınız.',
        citedChunkIds: ['c1'],
        memoryRecall: ['dietary_preference'],
      });
    const result = await agent.run({ ...input, currentMessage: 'Beslenme tercihim ne?' });
    expect(result.content).toBe('Beslenme tercihi bilgisi şu an hafızamda bulunmuyor.');
    expect(result.sources).toEqual([]);
  });
  it('renders semantic recall requests from current memory even when the model invents values', async () => {
    const { llm, agent } = setup();
    llm.chat.mockResolvedValue({
      kind: 'final',
      content: 'Deniz, vegan olarak kayıtlısınız.',
      citedChunkIds: [],
      memoryRecall: ['name', 'department', 'dietary_preference'],
    });
    const result = await agent.run({
      ...input,
      currentMessage: 'Benimle ilgili neleri hatırlıyorsun?',
      memories: [
        { key: 'name', value: 'İpek' },
        { key: 'dietary_preference', value: 'vegetarian' },
      ],
    });
    expect(result.content).toBe(
      'İsim: İpek.\nDepartman bilgisi şu an hafızamda bulunmuyor.\nBeslenme tercihi: vejetaryen.',
    );
  });
  it('uses a successful current-turn save in recall rather than the initial snapshot', async () => {
    const { llm, agent } = setup();
    llm.chat
      .mockResolvedValueOnce({
        kind: 'tool_calls',
        calls: [
          {
            id: 'save',
            name: 'save_memory',
            arguments: { key: 'dietary_preference', value: 'vegetarian' },
          },
        ],
      })
      .mockResolvedValueOnce({
        kind: 'final',
        content: 'Vegan.',
        citedChunkIds: [],
        memoryRecall: ['dietary_preference'],
      });
    const result = await agent.run({
      ...input,
      currentMessage: 'Vejetaryenim. Tercihim ne?',
      memories: [{ key: 'dietary_preference', value: 'vegan' }],
    });
    expect(result.content).toBe('Beslenme tercihi: vejetaryen.');
  });
  it('returns tool output to a second model call and uses validated source snapshots', async () => {
    const { llm, search, agent } = setup();
    llm.chat
      .mockResolvedValueOnce({
        kind: 'tool_calls',
        calls: [{ id: 'call1', name: 'search_docs', arguments: { query: 'İzin' } }],
      })
      .mockResolvedValueOnce({ kind: 'final', content: '20 gün', citedChunkIds: ['c1'] });
    const answer = await agent.run(input);
    expect(search.execute).toHaveBeenCalledTimes(1);
    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(llm.chat.mock.calls[1][0].toolResults[0]).toMatchObject({
      call: { id: 'call1' },
      output: { kind: 'search' },
    });
    expect(answer.sources).toEqual([
      { chunkId: 'c1', documentId: 'd1', title: 'İzin', excerpt: '20 gün' },
    ]);
  });
  it('supports memory then retrieval then final answer', async () => {
    const { llm, memory, agent } = setup();
    llm.chat
      .mockResolvedValueOnce({
        kind: 'tool_calls',
        calls: [
          {
            id: '1',
            name: 'save_memory',
            arguments: { key: 'dietary_preference', value: 'vegetarian' },
          },
        ],
      })
      .mockResolvedValueOnce({
        kind: 'tool_calls',
        calls: [{ id: '2', name: 'search_docs', arguments: { query: 'Yemek' } }],
      })
      .mockResolvedValueOnce({ kind: 'final', content: 'Cevap', citedChunkIds: ['c1'] });
    expect((await agent.run(input)).tools).toEqual(['save_memory', 'search_docs']);
    expect(memory.execute.mock.calls[0][1]).toMatchObject({ userId: 'u', messageId: 'm' });
  });
  it('rejects fabricated sources', async () => {
    const { llm, agent } = setup();
    llm.chat.mockResolvedValue({ kind: 'final', content: 'Cevap', citedChunkIds: ['fabricated'] });
    await expect(agent.run(input)).rejects.toThrow('geçersiz');
  });
  it.each([
    { name: 'unknown', arguments: {} },
    { name: 'save_memory', arguments: { key: 'name', value: 'Deniz', userId: 'another-user' } },
  ])('does not execute invalid tool calls: $name', async (call) => {
    const { llm, agent, search, memory } = setup();
    llm.chat
      .mockResolvedValueOnce({ kind: 'tool_calls', calls: [{ id: 'bad', ...call }] })
      .mockResolvedValueOnce({ kind: 'final', content: 'Tekrar deneyin.', citedChunkIds: [] });
    await agent.run(input);
    expect(search.execute).not.toHaveBeenCalled();
    expect(memory.execute).not.toHaveBeenCalled();
    expect(llm.chat.mock.calls[1][0].toolResults[0].output.kind).toBe('error');
  });
  it('caps repeated tool requests', async () => {
    const { llm, agent, search } = setup();
    let counter = 0;
    llm.chat.mockImplementation(async () => ({
      kind: 'tool_calls',
      calls: [{ id: String(++counter), name: 'search_docs', arguments: { query: 'İzin' } }],
    }));
    await expect(agent.run(input)).rejects.toThrow('adım sınırına');
    expect(search.execute).toHaveBeenCalledTimes(1);
  });
  it('aborts a stalled provider', async () => {
    const { llm, agent, config } = setup();
    config.AGENT_TIMEOUT_MS = 20;
    llm.chat.mockImplementation(() => new Promise(() => {}));
    await expect(agent.run(input)).rejects.toThrow('süresi doldu');
    expect(llm.chat.mock.calls[0][0].signal?.aborted).toBe(true);
  });
  it('counts provider verification continuations toward the model-step limit', async () => {
    const { llm, agent, config } = setup();
    llm.chat.mockResolvedValue({ kind: 'continue', state: { verification: true } });
    await expect(agent.run(input)).rejects.toThrow('adım sınırına');
    expect(llm.chat).toHaveBeenCalledTimes(config.AGENT_MAX_STEPS);
  });
  it('does not execute a late memory call after timeout', async () => {
    const { llm, agent, memory, config } = setup();
    config.AGENT_TIMEOUT_MS = 5;
    llm.chat.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        kind: 'tool_calls',
        calls: [{ id: 'late', name: 'save_memory', arguments: { key: 'name', value: 'Deniz' } }],
      };
    });
    await expect(agent.run(input)).rejects.toThrow('süresi doldu');
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(memory.execute).not.toHaveBeenCalled();
  });
  it('rejects duplicate call IDs before executing the second operation', async () => {
    const { llm, agent, memory } = setup();
    llm.chat.mockResolvedValueOnce({
      kind: 'tool_calls',
      calls: [
        { id: 'same', name: 'search_docs', arguments: { query: 'izin' } },
        { id: 'same', name: 'save_memory', arguments: { key: 'name', value: 'Deniz' } },
      ],
    });
    await expect(agent.run(input)).rejects.toThrow('kimliği');
    expect(memory.execute).not.toHaveBeenCalled();
  });
});

describe('P1 agent context revision boundary', () => {
  it('drops old history and provider continuation immediately after its own memory write', async () => {
    const { agent, llm, memory } = setup();
    memory.execute.mockResolvedValue({
      kind: 'memory',
      key: 'dietary_preference',
      value: 'vegetarian',
      status: 'updated',
      revision: 2,
    });
    llm.chat
      .mockResolvedValueOnce({
        kind: 'tool_calls',
        state: { old: 'Veganım' },
        calls: [
          {
            id: 'save',
            name: 'save_memory',
            arguments: { key: 'dietary_preference', value: 'vegetarian' },
          },
        ],
      })
      .mockResolvedValueOnce({ kind: 'final', content: 'Kaydedildi', citedChunkIds: [] });
    const refresh = jest
      .fn()
      .mockResolvedValue({
        revision: 2,
        memories: [{ key: 'dietary_preference', value: 'vegetarian' }],
        history: [],
        summary: 'İzin başvuru süreci',
      })
      .mockResolvedValueOnce({
        revision: 1,
        memories: [{ key: 'dietary_preference', value: 'vegan' }],
        history: [],
        summary: 'İzin başvuru süreci',
      });
    await agent.run({
      ...input,
      currentMessage: 'Vejetaryenim',
      contextRevision: 1,
      history: [{ role: 'user', content: 'Veganım' }],
      refreshContext: refresh,
    });
    expect(llm.chat.mock.calls[1][0]).toMatchObject({
      history: [],
      state: undefined,
      memories: [{ key: 'dietary_preference', value: 'vegetarian' }],
      summary: 'İzin başvuru süreci',
    });
  });
});
