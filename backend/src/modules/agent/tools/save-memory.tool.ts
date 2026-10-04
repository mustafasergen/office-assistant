import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { MemoryService } from '../../memory/memory.service';
import { extractMemoryFacts } from '../../memory/facts';
import { ToolOutput } from '../../llm/llm.types';

export const memoryArgs = z
  .object({
    key: z.enum(['name', 'department', 'dietary_preference']),
    value: z.string().trim().min(1).max(200),
  })
  .strict()
  .refine(
    (item) =>
      item.key !== 'dietary_preference' ||
      ['vegetarian', 'vegan', 'no_restriction'].includes(item.value),
    'Geçersiz beslenme tercihi.',
  );

@Injectable()
export class SaveMemoryTool {
  constructor(@Inject(MemoryService) private readonly memory: MemoryService) {}
  async execute(
    args: z.infer<typeof memoryArgs>,
    context: { userId: string; messageId: string; currentMessage: string },
    signal: AbortSignal,
  ): Promise<ToolOutput> {
    signal.throwIfAborted();
    const supported = extractMemoryFacts(context.currentMessage).some(
      (fact) =>
        fact.key === args.key &&
        fact.value.toLocaleLowerCase('tr') === args.value.toLocaleLowerCase('tr'),
    );
    if (!supported)
      return {
        kind: 'error',
        message:
          'Bu bilgi mevcut mesajda desteklenen açık bir beyan olarak yer almıyor. Hafızayı değiştirme; mevcut hafıza ile cevap ver.',
      };
    return this.memory.save(context.userId, context.messageId, args.key, args.value);
  }
}
