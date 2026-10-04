import { SaveMemoryTool } from './save-memory.tool';
import { MemoryService } from '../../memory/memory.service';
import { extractMemoryFacts } from '../../memory/facts';

const context = { userId: 'u', messageId: 'm', currentMessage: 'Beslenme tercihim ne?' };
describe('memory write grounding', () => {
  it.each(['Beslenme tercihim ne?', 'Adım ne?', 'Vejetaryen miyim?'])(
    'never treats a recall question as a fact: %s',
    (message) => {
      expect(extractMemoryFacts(message)).toEqual([]);
    },
  );
  it('rejects a model-invented preference without writing to the database', async () => {
    const memory = { save: jest.fn() };
    const tool = new SaveMemoryTool(memory as unknown as MemoryService);
    const result = await tool.execute(
      { key: 'dietary_preference', value: 'no_restriction' },
      context,
      new AbortController().signal,
    );
    expect(result.kind).toBe('error');
    expect(memory.save).not.toHaveBeenCalled();
  });
  it('permits an explicit declaration combined with a question', async () => {
    const memory = { save: jest.fn().mockResolvedValue({ kind: 'memory', status: 'created' }) };
    const tool = new SaveMemoryTool(memory as unknown as MemoryService);
    await tool.execute(
      { key: 'dietary_preference', value: 'vegetarian' },
      { ...context, currentMessage: 'Vejetaryenim, yemek seçenekleri neler?' },
      new AbortController().signal,
    );
    expect(memory.save).toHaveBeenCalledWith(
      'u',
      'm',
      'dietary_preference',
      'vegetarian',
      undefined,
    );
  });
});
