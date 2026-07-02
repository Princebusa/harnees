import type { ChatOptions, ChatResponse } from "./types.ts";
import { chatOpenAI, chatOpenAIStream } from "./openai.ts";
import { chatOllama, chatOllamaStream } from "./ollama.ts";
import { chatAnthropic, chatAnthropicStream } from "./anthropic.ts";

export async function chat(options: ChatOptions): Promise<ChatResponse> {
  const apiStyle = options.provider?.apiStyle ?? "openai-chat";

  if (apiStyle === "ollama-chat") {
    return options.onToken
      ? chatOllamaStream(options)
      : chatOllama(options);
  }

  if (apiStyle === "anthropic-chat") {
    return options.onToken
      ? chatAnthropicStream(options)
      : chatAnthropic(options);
  }

  // Default to openai-chat style
  return options.onToken
    ? chatOpenAIStream(options)
    : chatOpenAI(options);
}
