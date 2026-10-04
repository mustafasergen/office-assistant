import { ChatInput, ChatResult, type LLMProvider } from '../llm.types';
import { hashEmbedding, normalize } from '../text';
import { groundedMockMatches, focusedMockAnswer } from '../mock-grounding';
import { extractMemoryFacts } from '../../memory/facts';

export class MockLLM implements LLMProvider {
  readonly embeddingKey = 'mock:sha256-tf:normalize-v3:1536';
  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    signal?.throwIfAborted();
    return texts.map((text) => hashEmbedding(text));
  }
  async chat(input: ChatInput): Promise<ChatResult> {
    input.signal?.throwIfAborted();
    const last = input.toolResults.at(-1);
    if (last?.output.kind === 'error')
      return {
        kind: 'final',
        content: 'Bu işlemi tamamlayamadım. Lütfen tekrar deneyin.',
        citedChunkIds: [],
      };

    const facts = extractMemoryFacts(input.currentMessage);
    const saved = input.toolResults.flatMap((r) => (r.output.kind === 'memory' ? [r.output] : []));
    const pending = facts.find(
      (fact) => !saved.some((item) => item.key === fact.key && item.value === fact.value),
    );
    if (pending)
      return {
        kind: 'tool_calls',
        calls: [
          { id: `mock-${input.toolResults.length + 1}`, name: 'save_memory', arguments: pending },
        ],
      };

    const normalized = normalize(input.currentMessage);
    const recallKey = /\b(adim|ismim)\b.*\b(ne|nedir|neydi)\b/.test(normalized)
      ? 'name'
      : /\btercihim\b.*\b(ne|nedir|neydi)\b/.test(normalized)
        ? 'dietary_preference'
        : /\bdepartmanim\b.*\b(ne|nedir|neydi)\b/.test(normalized)
          ? 'department'
          : undefined;
    if (recallKey) {
      const fact = [...input.memories, ...saved].filter((item) => item.key === recallKey).at(-1);
      const label =
        fact?.value === 'vegetarian'
          ? 'vejetaryen'
          : fact?.value === 'no_restriction'
            ? 'beslenme kısıtlaman yok'
            : fact?.value;
      return {
        kind: 'final',
        content: fact ? `Hafızamdaki bilgin: ${label}.` : 'Bu bilgi şu an hafızamda bulunmuyor.',
        citedChunkIds: [],
      };
    }
    const isQuestion = /\?|\b(kac|nedir|neler|nasil|hangi|ne zaman|limit|bilgi|anlat)\b/.test(
      normalized,
    );
    const searches = input.toolResults.filter((r) => r.output.kind === 'search');
    const queryParts = input.currentMessage
      .split(/\s+ve\s+|[,;]/iu)
      .map((part) => part.trim())
      .filter((part) => part && !extractMemoryFacts(part).length);
    const questionParts = queryParts.length > 1 ? queryParts : [input.currentMessage];
    const pendingQuery = questionParts.find(
      (query) =>
        !(questionParts.length === 1 && searches.length) &&
        !searches.some((result) => (result.call.arguments as { query?: string }).query === query),
    );
    if (isQuestion && pendingQuery)
      return {
        kind: 'tool_calls',
        calls: [
          {
            id: `mock-${input.toolResults.length + 1}`,
            name: 'search_docs',
            arguments: { query: pendingQuery },
          },
        ],
      };

    if (searches.length) {
      const matches = groundedMockMatches(
        input.currentMessage,
        searches.flatMap((result) =>
          result.output.kind === 'search' ? result.output.matches : [],
        ),
      );
      if (!matches.length)
        return {
          kind: 'final',
          content:
            'Bu sorunun cevabını şirket dokümanlarında bulamadım. İzin, yemek kartı, ofis kuralları veya çalışma düzeni hakkında sorabilirsin.',
          citedChunkIds: [],
        };
      const memories = [...input.memories, ...saved];
      const diet = memories.filter((m) => m.key === 'dietary_preference').at(-1)?.value;
      const prefix =
        /yemek|menu|beslen/.test(normalized) && (diet === 'vegetarian' || diet === 'vegan')
          ? `Beslenme tercihini (${diet === 'vegetarian' ? 'vejetaryen' : 'vegan'}) hatırlıyorum. İlgili seçenekler için şirket dokümanındaki bilgi:\n\n`
          : '';
      return {
        kind: 'final',
        content:
          prefix +
          questionParts
            .map((query) => {
              const selected = groundedMockMatches(query, matches);
              return selected.length
                ? selected.map((match) => focusedMockAnswer(query, match)).join('\n\n')
                : `“${query}” sorusunun cevabını şirket dokümanlarında bulamadım.`;
            })
            .join('\n\n'),
        citedChunkIds: matches.map((match) => match.chunkId),
      };
    }
    if (saved.length)
      return {
        kind: 'final',
        content:
          'Bu bilgiyi hafızama kaydettim. Yeni konuşmalarımızda da dikkate alacağım. Hafıza panelinden görebilir veya silebilirsin.',
        citedChunkIds: [],
      };
    return {
      kind: 'final',
      content: /^(merhaba|selam|gunaydin|iyi gunler|tesekkur)/.test(normalized)
        ? 'Merhaba! İzin, yemek kartı, ofis kuralları ve çalışma düzeni hakkında yardımcı olabilirim.'
        : 'Mesajını anlayamadım. Sorunu biraz daha açık yazabilir misin? Örneğin “Yıllık izin kaç gün?” diye sorabilirsin.',
      citedChunkIds: [],
    };
  }
}
