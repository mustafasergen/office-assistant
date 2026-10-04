import type { MemoryFact } from '../llm/llm.types';
import { normalize } from '../llm/text';

export const MEMORY_KEYS = ['name', 'department', 'dietary_preference'] as const;
export type MemoryKey = (typeof MEMORY_KEYS)[number];

/** Conservative fallback for direct recall questions; mixed policy questions stay in the agent. */
export function directRecallKeys(message: string): MemoryKey[] {
  const text = normalize(message)
    .trim()
    .replace(/[?.!]+$/, '')
    .trim();
  if (/^(?:benim )?(?:beslenme |yemek |belenme )?tercihim (?:ne|nedir|neydi)$/.test(text))
    return ['dietary_preference'];
  if (/^(?:benim )?(?:adim|ismim) (?:ne|nedir|neydi)$/.test(text)) return ['name'];
  if (/^(?:benim )?departmanim (?:ne|nedir|neydi)$/.test(text)) return ['department'];
  return [];
}

/** A recall answer is rendered from current records, never generated from the transcript. */
export function recallAnswer(keys: MemoryKey[], memories: MemoryFact[]): string {
  const labels: Record<MemoryKey, string> = {
    name: 'İsim',
    department: 'Departman',
    dietary_preference: 'Beslenme tercihi',
  };
  return [...new Set(keys)]
    .map((key) => {
      const fact = memories.filter((item) => item.key === key).at(-1);
      if (!fact) return `${labels[key]} bilgisi şu an hafızamda bulunmuyor.`;
      const value =
        key === 'dietary_preference' && fact.value === 'vegetarian'
          ? 'vejetaryen'
          : key === 'dietary_preference' && fact.value === 'no_restriction'
            ? 'beslenme kısıtlaman yok'
            : fact.value;
      return `${labels[key]}: ${value}.`;
    })
    .join('\n');
}
