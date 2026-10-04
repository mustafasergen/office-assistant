import type { MemoryKey } from '../memory/recall';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
export const EMBEDDING_DIMENSIONS = 1536;
export interface MemoryFact {
  key: string;
  value: string;
}
export interface SearchMatch {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  score: number;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}
export type ToolOutput =
  | { kind: 'search'; matches: SearchMatch[] }
  | {
      kind: 'memory';
      key: string;
      value: string;
      status: 'created' | 'updated' | 'unchanged';
      revision?: number;
    }
  | { kind: 'error'; message: string };
export interface ToolResult {
  call: ToolCall;
  output: ToolOutput;
}
export interface ChatInput {
  currentMessage: string;
  query?: string;
  summary?: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  memories: MemoryFact[];
  toolResults: ToolResult[];
  state?: unknown;
  signal?: AbortSignal;
}
export type ChatResult =
  | { kind: 'final'; content: string; citedChunkIds: string[]; memoryRecall?: MemoryKey[] }
  | { kind: 'continue'; state: unknown }
  | { kind: 'tool_calls'; calls: ToolCall[]; state?: unknown };
export interface LLMProvider {
  readonly embeddingKey: string;
  chat(input: ChatInput): Promise<ChatResult>;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}
