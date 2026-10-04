import { foldTopics, resolveFollowUp, safeTopics, topicEvent, topicText } from './topics';
const empty = { topics: [], latest: [] };
describe('safe deterministic topic summary', () => {
  it.each(['Veganım', 'Arkadaşım vegan', 'Adım Deniz', 'Beslenme tercihim ne?', 'Teşekkürler'])(
    'P1 personal statement is not a topic/value: %s',
    (text) => {
      const state = foldTopics(empty, topicEvent(text));
      expect(state.topics).toEqual([]);
      expect(topicText(state)).not.toMatch(/vegan|Deniz|arkadaş/);
    },
  );
  it('P1 rejects arbitrary summary keys including prototype names', () => {
    expect(
      safeTopics(['vegan', 'name', '__proto__', 'leave_application', 'leave_application']),
    ).toEqual(['leave_application']);
  });
  it('P2 keeps a company topic through personal updates and deduplicates it', () => {
    let state = empty as Parameters<typeof foldTopics>[0];
    for (const text of [
      'İzin başvurusu nasıl yapılır?',
      'Veganım',
      'Artık vejetaryenim',
      'İzin başvurusu nasıl yapılır?',
    ])
      state = foldTopics(state, topicEvent(text));
    expect(state.topics).toEqual(['leave_application']);
    expect(resolveFollowUp('Peki kaç gün önceden?', state).query).toBe(
      'Yıllık izin talebi kaç gün önceden iletilir?',
    );
  });
  it.each(['Peki.', 'Peki!', '  PEKİ  ', 'Tamam.', 'Anladım.'])(
    'P2 bare acknowledgement %s preserves context without clarification',
    (text) => {
      const state = foldTopics(empty, topicEvent('İzin başvurusu nasıl yapılır?'));
      expect(resolveFollowUp(text, state)).toEqual({ query: text });
      expect(foldTopics(state, topicEvent(text))).toEqual(state);
      expect(resolveFollowUp('Peki kaç gün önceden?', state).query).toContain('izin talebi');
      expect(resolveFollowUp('Peki?', state).clarification).toBeDefined();
    },
  );
  it('P2 clarifies competing topics and insufficient context', () => {
    const multi = foldTopics(
      empty,
      topicEvent('İzin başvurusu ve toplantı odası rezervasyonu nasıl yapılır?'),
    );
    expect(resolveFollowUp('Peki kaç gün önceden?', multi).clarification).toBeDefined();
    expect(resolveFollowUp('Peki kaç gün önceden?', empty).clarification).toBeDefined();
  });
  it('P2 explicit recent topic and unrelated questions supersede older summaries', () => {
    const old = foldTopics(empty, topicEvent('İzin başvurusu nasıl yapılır?'));
    const latest = foldTopics(old, topicEvent('Yemek kartı limiti ne kadar?'));
    expect(resolveFollowUp('Peki kaç gün önceden?', latest).clarification).toBeDefined();
    const unknown = foldTopics(old, topicEvent('Mars kaç kilometre?'));
    expect(unknown.latest).toEqual([]);
    expect(resolveFollowUp('Peki kaç gün önceden?', unknown).clarification).toBeDefined();
    expect(resolveFollowUp('Yemek kartı limiti ne kadar?', old).query).toBe(
      'Yemek kartı limiti ne kadar?',
    );
  });
});
