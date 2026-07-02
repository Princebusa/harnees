import type { Message, Tool, ToolCall } from "../agent/types.ts";

export interface FreeModel {
  id: string;
  name: string;
  note?: string;
}

/** How request/response bodies are shaped. */
export type ApiStyle = "openai-chat" | "ollama-chat" | "anthropic-chat";

export interface Provider {
  id: string;
  label: string;
  /** API root, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  /** Path appended to baseUrl, e.g. chat/completions */
  endpoint: string;
  apiStyle: ApiStyle;
  defaultModel: string;
  apiKeyEnvVars: string[];
  /** Local providers like Ollama don't require a key */
  apiKeyOptional?: boolean;
  freeModels: FreeModel[];
  extraHeaders?: Record<string, string>;
}

export interface ResolvedProviderConfig {
  provider: Provider;
  apiUrl: string;
  model: string;
  apiKey: string;
}

export interface ChatOptions {
  messages: Message[];
  tools?: Tool[];
  model: string;
  apiKey: string;
  apiUrl: string;
  provider?: Provider;
  onToken?: (chunk: string) => void;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
}
