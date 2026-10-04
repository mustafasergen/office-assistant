import { isAcknowledgement, normalize } from '../../llm/text';
import { extractMemoryFacts } from '../../memory/facts';
import { directRecallKeys } from '../../memory/recall';

export const TOPICS = {
  leave_application: 'İzin başvuru süreci',
  annual_leave: 'Yıllık izin hakkı',
  meal_card: 'Yemek kartı',
  meal_options: 'Yemek seçenekleri',
  office_rules: 'Ofis kuralları',
  meeting_room: 'Toplantı odası rezervasyonu',
  working_hours: 'Çalışma saatleri',
  remote_work: 'Uzaktan çalışma',
} as const;
export type Topic = keyof typeof TOPICS;
export interface TopicState {
  topics: Topic[];
  latest: Topic[];
}
export interface ContextSummary extends TopicState {
  version: 1;
  through: string;
}
export const CONTEXT_LIMITS = {
  messages: 20,
  characters: 12000,
  recentMessages: 8,
  recentCharacters: 8000,
};
export function safeTopics(value: unknown): Topic[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((x): x is Topic => typeof x === 'string' && Object.hasOwn(TOPICS, x)),
        ),
      ]
    : [];
}
export function topicEvent(content: string): Topic[] | undefined {
  const n = normalize(content);
  const topics: Topic[] = [];
  if (/\bizin\b/.test(n))
    topics.push(
      /basvur|talep|onceden|yonetici|onay/.test(n) ? 'leave_application' : 'annual_leave',
    );
  if (/yemek kart|bakiye/.test(n)) topics.push('meal_card');
  if (/menu|yemek secenek|yemek oner/.test(n)) topics.push('meal_options');
  if (/ofis kural/.test(n)) topics.push('office_rules');
  if (/toplanti oda|rezervasyon/.test(n)) topics.push('meeting_room');
  if (/mesai|calisma saat|ogle arasi/.test(n)) topics.push('working_hours');
  if (/uzaktan|hibrit/.test(n)) topics.push('remote_work');
  if (topics.length) return topics;
  if (extractMemoryFacts(content).length || directRecallKeys(content).length) return undefined;
  return /\?|\b(kac|nedir|nasil|hangi|neler)\b/.test(n) ? [] : undefined;
}
export function foldTopics(state: TopicState, event: Topic[] | undefined): TopicState {
  if (!event) return state;
  return {
    topics: [...state.topics.filter((x) => !event.includes(x)), ...event].slice(-8),
    latest: event,
  };
}
export function topicText(state: TopicState): string {
  const topics = safeTopics(state.topics);
  const latest = safeTopics(state.latest);
  return `Konuşulan konular: ${topics.map((x) => TOPICS[x]).join(', ') || 'Belirlenemedi'}. Özetlenen bölümdeki son konu: ${latest.map((x) => TOPICS[x]).join(', ') || 'Belirsiz'}. Bu özet kişisel bilgi veya şirket kuralı kanıtı değildir.`;
}
export function resolveFollowUp(
  content: string,
  state: TopicState,
): { query: string; clarification?: string } {
  if (isAcknowledgement(content)) return { query: content };
  const n = normalize(content);
  const event = topicEvent(content);
  if (event?.length || extractMemoryFacts(content).length || directRecallKeys(content).length)
    return { query: content };
  if (!/^(peki\b|onun\b|bunun\b|o zaman\b|kac gun onceden)/.test(n)) return { query: content };
  if (
    state.latest.length === 1 &&
    state.latest[0] === 'leave_application' &&
    /kac gun onceden/.test(n)
  )
    return { query: 'Yıllık izin talebi kaç gün önceden iletilir?' };
  return {
    query: content,
    clarification:
      state.latest.includes('leave_application') || state.latest.includes('annual_leave')
        ? 'İzin başvurusunu mu kastediyorsun?'
        : 'Hangi konuyu kastediyorsun? Biraz açabilir misin?',
  };
}
