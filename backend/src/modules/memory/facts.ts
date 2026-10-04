import type { MemoryFact } from '../llm/llm.types';
import { normalize } from '../llm/text';

/** Only standalone first-person declarations count; quoted, hypothetical and reported speech do not. */
function declarations(text: string): string[] {
  let reportedBlock = false;
  const unquoted = text
    .replace(/```[\s\S]*?```|`[^`]*`|"[^"]*"|“[^”]*”|«[^»]*»|‘[^’]*’/g, '')
    .split('\n')
    .filter((line) => {
      if (!line.trim()) {
        reportedBlock = false;
        return false;
      }
      if (/(?:ornek cumle|dedi ki|soyle dedi)\s*:$/.test(normalize(line))) {
        reportedBlock = true;
        return false;
      }
      return !reportedBlock && !/^\s*>/.test(line);
    })
    .join('\n');
  // Explicit present-tense correction supersedes earlier/historical clauses.
  const present = unquoted.split(/(?:^|[\s,.;])(?:şimdi|artık)\s+/iu).at(-1)!;
  return present
    .split(/[.!?;,\n]|\s+(?:ama|ancak|fakat|ve)\s+/iu)
    .map((part) => part.trim())
    .filter(Boolean);
}
export function extractMemoryRetractions(text: string): string[] {
  return declarations(text).flatMap((part) => {
    const match = normalize(part).match(/^(?:ben )?(vegan|vejetaryen) degilim$/);
    return match ? [match[1] === 'vegan' ? 'vegan' : 'vegetarian'] : [];
  });
}
export function extractMemoryFacts(text: string): MemoryFact[] {
  const candidates: MemoryFact[] = [];
  for (const part of declarations(text)) {
    const value = normalize(part);
    if (/^(?:ben )?(vejetaryenim|vejetaryen biriyim)$/.test(value))
      candidates.push({ key: 'dietary_preference', value: 'vegetarian' });
    if (/^(?:ben )?veganim$/.test(value))
      candidates.push({ key: 'dietary_preference', value: 'vegan' });
    if (/^(?:benim )?beslenme (kisitlamam yok|kisitlamasi yok)$/.test(value))
      candidates.push({ key: 'dietary_preference', value: 'no_restriction' });
    const name = value.match(/^(?:benim )?(?:adim|ismim) ([a-z]+(?:[ -][a-z]+)?)$/);
    if (name && !/\b(ne|nedir|kim|neydi|mi|mu)\b/.test(name[1])) {
      // Prefix length is determined by the optional "benim", preserving Turkish name spelling.
      const words = part.split(/\s+/);
      candidates.push({
        key: 'name',
        value: words.slice(value.startsWith('benim ') ? 2 : 1).join(' '),
      });
    }
    const department = value.match(/^([a-z]+) (?:departmaninda|ekibinde) calisiyorum$/);
    if (department) candidates.push({ key: 'department', value: part.split(/\s+/)[0] });
  }
  const denied = extractMemoryRetractions(text);
  return [...new Set(candidates.map((fact) => fact.key))].flatMap((key) => {
    const values = candidates.filter((fact) => fact.key === key);
    const distinct = new Set(values.map((fact) => normalize(fact.value)));
    if (distinct.size !== 1 || (key === 'dietary_preference' && denied.includes(values[0].value)))
      return [];
    return [values[0]];
  });
}
