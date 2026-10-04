import {
  BadGatewayException,
  ConflictException,
  GatewayTimeoutException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { type AppConfig, CONFIG } from '../../config/config';
import { Citation } from '../../database/entities';
import {
  ChatInput,
  LLM_PROVIDER,
  type LLMProvider,
  SearchMatch,
  ToolOutput,
  ToolResult,
} from '../llm/llm.types';
import { normalize } from '../llm/text';
import { directRecallKeys, recallAnswer } from '../memory/recall';
import { SaveMemoryTool, memoryArgs } from './tools/save-memory.tool';
import { SearchDocsTool, searchArgs } from './tools/search-docs.tool';

export interface AgentInput extends Pick<
  ChatInput,
  'currentMessage' | 'history' | 'memories' | 'summary' | 'query'
> {
  userId: string;
  messageId: string;
  contextRevision?: number;
  refreshContext?: () => Promise<{
    revision: number;
    memories: ChatInput['memories'];
    history: ChatInput['history'];
    summary?: string;
  }>;
}
export interface AgentAnswer {
  content: string;
  sources: Citation[];
  tools: string[];
  contextRevision?: number;
}

@Injectable()
export class AgentService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(SearchDocsTool) private readonly search: SearchDocsTool,
    @Inject(SaveMemoryTool) private readonly memory: SaveMemoryTool,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}
  async run(input: AgentInput): Promise<AgentAnswer> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new GatewayTimeoutException('Asistanın yanıt süresi doldu.'));
      }, this.config.AGENT_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.loop(input, controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  private async loop(input: AgentInput, signal: AbortSignal): Promise<AgentAnswer> {
    input = { ...input };
    const results: ToolResult[] = [];
    const sources = new Map<string, SearchMatch>();
    const executed = new Set<string>();
    const callIds = new Set<string>();
    let state: unknown;
    const refresh = async (ownRevision?: number) => {
      if (!input.refreshContext) return;
      const fresh = await input.refreshContext();
      if (fresh.revision !== (ownRevision ?? input.contextRevision))
        throw new ConflictException('Hafıza yanıt hazırlanırken değişti. Mesajını tekrar gönder.');
      if (fresh.revision !== input.contextRevision) {
        input = {
          ...input,
          contextRevision: fresh.revision,
          memories: fresh.memories,
          history: [],
          summary: fresh.summary,
        };
        state = undefined;
      }
    };
    for (let step = 0; step < this.config.AGENT_MAX_STEPS; step++) {
      signal.throwIfAborted();
      await refresh();
      const response = await this.llm.chat({ ...input, toolResults: results, state, signal });
      signal.throwIfAborted();
      if (response.kind === 'continue') {
        state = response.state;
        continue;
      }
      if (response.kind === 'final') {
        await refresh();
        if (!response.content.trim() || response.citedChunkIds.some((id) => !sources.has(id)))
          throw new BadGatewayException('Model geçersiz cevap veya kaynak üretti.');
        // Chat history survives deletion. Only the current snapshot and successful writes
        // in this run can establish what is currently saved about the user.
        const recallKeys = directRecallKeys(input.currentMessage);
        const requestedKeys = recallKeys.length ? recallKeys : (response.memoryRecall ?? []);
        if (recallKeys.length || (requestedKeys.length && !response.citedChunkIds.length)) {
          return {
            content: recallAnswer(requestedKeys, [
              ...input.memories,
              ...results.flatMap((r) => (r.output.kind === 'memory' ? [r.output] : [])),
            ]),
            contextRevision: input.contextRevision,
            sources: [],
            tools: results.map((r) => r.call.name),
          };
        }
        const question = /\?|\b(kac|nedir|neler|nasil|hangi|ne zaman|limit)\b/.test(
          normalize(input.query ?? input.currentMessage),
        );
        const memoryQuestion =
          /\b(adim|ismim|tercihim|departmanim|beni|hatirliyor|kaydeder|kaydet)\b/.test(
            normalize(input.query ?? input.currentMessage),
          );
        const unsupportedQuestion = question && !memoryQuestion && !response.citedChunkIds.length;
        return {
          content: unsupportedQuestion
            ? 'Bu sorunun cevabını şirket dokümanlarında bulamadım. Sorunu farklı ifade edebilir veya ilgili dokümanı ekleyebilirsin.'
            : response.content,
          contextRevision: input.contextRevision,
          sources: [...new Set(response.citedChunkIds)].map((id) => {
            const match = sources.get(id)!;
            return {
              chunkId: id,
              documentId: match.documentId,
              title: match.title,
              excerpt: match.content,
            };
          }),
          tools: results.map((r) => r.call.name),
        };
      }
      state = response.state;
      if (
        !response.calls.length ||
        results.length + response.calls.length > this.config.AGENT_MAX_STEPS
      )
        throw new BadGatewayException('Tool çağrısı sınırı aşıldı.');
      for (const call of response.calls) {
        signal.throwIfAborted();
        if (!call.id || callIds.has(call.id))
          throw new BadGatewayException('Model yinelenen veya boş tool çağrı kimliği üretti.');
        callIds.add(call.id);
        let output: ToolOutput;
        const signature = JSON.stringify([call.name, call.arguments]);
        if (executed.has(signature))
          output = {
            kind: 'error',
            message: 'This tool has already run with the same arguments. Use the existing result.',
          };
        else {
          executed.add(signature);
          const args =
            call.name === 'search_docs'
              ? searchArgs.safeParse(call.arguments)
              : call.name === 'save_memory'
                ? memoryArgs.safeParse(call.arguments)
                : null;
          if (!args?.success)
            output = { kind: 'error', message: 'Unknown tool or invalid arguments.' };
          else if (call.name === 'search_docs')
            output = await this.search.execute(searchArgs.parse(args.data), signal);
          else {
            output = await this.memory.execute(memoryArgs.parse(args.data), input, signal);
            if (output.kind === 'memory') await refresh(output.revision);
          }
        }
        signal.throwIfAborted();
        if (output.kind === 'search')
          for (const match of output.matches) sources.set(match.chunkId, match);
        results.push({ call, output });
      }
    }
    throw new BadGatewayException('Asistan adım sınırına ulaştı. Lütfen soruyu sadeleştirin.');
  }
}
