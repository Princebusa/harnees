import type { Message, Tool, ToolCall } from "../agent/types.ts";
import type { ChatOptions, ChatResponse, Provider } from "./types.ts";

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface StreamToolCallDelta {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

function toOpenAIMessages(messages: Message[]) {
  return messages.map((msg) => {
    if (msg.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: msg.toolCallId,
        content: msg.content,
      };
    }

    if (msg.role === "assistant" && msg.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        })),
      };
    }

    return {
      role: msg.role,
      content: msg.content,
    };
  });
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

function buildOpenAIRequestBody(options: ChatOptions, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: toOpenAIMessages(options.messages),
    stream,
  };

  if (options.tools?.length) {
    body.tools = toOpenAITools(options.tools);
    body.tool_choice = "auto";
  }

  return body;
}

function parseOpenAIToolCalls(calls: OpenAIToolCall[]): ToolCall[] {
  return calls.map((call) => {
    let parsed: Record<string, unknown> = {};

    try {
      parsed = JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch {
      parsed = { raw: call.function.arguments };
    }

    return {
      id: call.id,
      name: call.function.name,
      arguments: parsed,
    };
  });
}

function mergeStreamedToolCalls(
  acc: Map<number, { id: string; name: string; arguments: string }>,
  deltas: StreamToolCallDelta[],
): void {
  for (const tc of deltas) {
    const idx = tc.index ?? 0;
    let entry = acc.get(idx);
    if (!entry) {
      entry = { id: "", name: "", arguments: "" };
      acc.set(idx, entry);
    }
    if (tc.id) entry.id = tc.id;
    if (tc.function?.name) entry.name += tc.function.name;
    if (tc.function?.arguments) entry.arguments += tc.function.arguments;
  }
}

function toolCallsFromAccumulator(
  acc: Map<number, { id: string; name: string; arguments: string }>,
): ToolCall[] {
  return [...acc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, entry]) => {
      let parsed: Record<string, unknown> = {};

      try {
        parsed = JSON.parse(entry.arguments) as Record<string, unknown>;
      } catch {
        parsed = { raw: entry.arguments };
      }

      return {
        id: entry.id,
        name: entry.name,
        arguments: parsed,
      };
    });
}

export async function chatOpenAIStream(options: ChatOptions): Promise<ChatResponse> {
  const { apiKey, apiUrl, provider, onToken } = options;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: buildRequestHeaders(apiKey, provider),
    body: JSON.stringify(buildOpenAIRequestBody(options, true)),
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
  let finishReason = "";
  const toolCallAcc = new Map<number, { id: string; name: string; arguments: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;

      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;

      let parsed: {
        choices?: Array<{
          finish_reason?: string | null;
          delta?: {
            content?: string | null;
            tool_calls?: StreamToolCallDelta[];
          };
        }>;
      };

      try {
        parsed = JSON.parse(data) as typeof parsed;
      } catch {
        continue;
      }

      const choice = parsed.choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      const delta = choice.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        onToken?.(delta.content);
      }

      if (delta.tool_calls?.length) {
        mergeStreamedToolCalls(toolCallAcc, delta.tool_calls);
      }
    }
  }

  return {
    content,
    toolCalls: toolCallsFromAccumulator(toolCallAcc),
    finishReason,
  };
}

export async function chatOpenAI(options: ChatOptions): Promise<ChatResponse> {
  const { apiKey, apiUrl, provider } = options;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: buildRequestHeaders(apiKey, provider),
    body: JSON.stringify(buildOpenAIRequestBody(options, false)),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    choices: Array<{
      finish_reason: string;
      message: {
        content: string | null;
        tool_calls?: OpenAIToolCall[];
      };
    }>;
  };

  const choice = data.choices[0];
  if (!choice) {
    throw new Error("LLM returned no choices");
  }

  return {
    content: choice.message.content ?? "",
    toolCalls: parseOpenAIToolCalls(choice.message.tool_calls ?? []),
    finishReason: choice.finish_reason,
  };
}
