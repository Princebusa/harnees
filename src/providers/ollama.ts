import type { Message, Tool, ToolCall } from "../agent/types.ts";
import type { ChatOptions, ChatResponse, Provider } from "./types.ts";

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

function toOllamaMessages(messages: Message[]) {
  return messages
    .filter((msg) => msg.role !== "tool")
    .map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
}

function toOpenAITools(tools: Tool[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.definition.name,
      description: tool.definition.description,
      parameters: tool.definition.parameters,
    },
  }));
}

function buildRequestHeaders(apiKey: string, provider?: Provider): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...provider?.extraHeaders,
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function buildOllamaRequestBody(options: ChatOptions, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: toOllamaMessages(options.messages),
    stream,
  };

  if (options.tools?.length) {
    body.tools = toOpenAITools(options.tools);
  }

  return body;
}

function parseOllamaToolCalls(calls: OllamaToolCall[]): ToolCall[] {
  return calls.map((call, index) => ({
    id: `ollama-${index}`,
    name: call.function.name,
    arguments: call.function.arguments ?? {},
  }));
}

export async function chatOllamaStream(options: ChatOptions): Promise<ChatResponse> {
  const { apiKey, apiUrl, provider, onToken } = options;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: buildRequestHeaders(apiKey, provider),
    body: JSON.stringify(buildOllamaRequestBody(options, true)),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${body}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("LLM returned no response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let toolCalls: ToolCall[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: {
        done?: boolean;
        message?: {
          content?: string;
          tool_calls?: OllamaToolCall[];
        };
      };

      try {
        parsed = JSON.parse(trimmed) as typeof parsed;
      } catch {
        continue;
      }

      if (parsed.message?.content) {
        content += parsed.message.content;
        onToken?.(parsed.message.content);
      }

      if (parsed.done && parsed.message?.tool_calls?.length) {
        toolCalls = parseOllamaToolCalls(parsed.message.tool_calls);
      }
    }
  }

  return {
    content,
    toolCalls,
    finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
  };
}

export async function chatOllama(options: ChatOptions): Promise<ChatResponse> {
  const { apiKey, apiUrl, provider } = options;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: buildRequestHeaders(apiKey, provider),
    body: JSON.stringify(buildOllamaRequestBody(options, false)),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    message?: {
      content?: string;
      tool_calls?: OllamaToolCall[];
    };
  };

  return {
    content: data.message?.content ?? "",
    toolCalls: parseOllamaToolCalls(data.message?.tool_calls ?? []),
    finishReason: data.message?.tool_calls?.length ? "tool_calls" : "stop",
  };
}
