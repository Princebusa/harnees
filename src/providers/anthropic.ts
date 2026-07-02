import type { Message, Tool, ToolCall } from "../agent/types.ts";
import type { ChatOptions, ChatResponse, Provider } from "./types.ts";

interface AnthropicTextContent {
  type: "text";
  text: string;
}

interface AnthropicToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

type AnthropicMessageContent =
  | AnthropicTextContent
  | AnthropicToolUseContent
  | AnthropicToolResultContent;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicMessageContent[];
}

export function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
  const filtered = messages.filter((msg) => msg.role !== "system");
  const result: AnthropicMessage[] = [];

  for (const msg of filtered) {
    const role: "user" | "assistant" = msg.role === "assistant" ? "assistant" : "user";
    const contentBlocks: AnthropicMessageContent[] = [];

    if (msg.role === "tool") {
      contentBlocks.push({
        type: "tool_result",
        tool_use_id: msg.toolCallId ?? "",
        content: msg.content,
      });
    } else if (msg.role === "assistant" && msg.toolCalls?.length) {
      if (msg.content) {
        contentBlocks.push({
          type: "text",
          text: msg.content,
        });
      }
      for (const call of msg.toolCalls) {
        contentBlocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
    } else {
      contentBlocks.push({
        type: "text",
        text: msg.content || "",
      });
    }

    const last = result[result.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) {
      last.content.push(...contentBlocks);
    } else {
      result.push({ role, content: contentBlocks });
    }
  }

  return result;
}

function toAnthropicTools(tools: Tool[]) {
  return tools.map((tool) => ({
    name: tool.definition.name,
    description: tool.definition.description,
    input_schema: tool.definition.parameters,
  }));
}

function buildAnthropicHeaders(apiKey: string, provider?: Provider): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    ...provider?.extraHeaders,
  };

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  return headers;
}

function buildAnthropicRequestBody(options: ChatOptions, stream: boolean): Record<string, unknown> {
  const system = options.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n") || undefined;

  const anthropicMessages = toAnthropicMessages(options.messages);

  const body: Record<string, unknown> = {
    model: options.model,
    messages: anthropicMessages,
    max_tokens: 4096, // Anthropic requires max_tokens
    stream,
  };

  if (system) {
    body.system = system;
  }

  if (options.tools?.length) {
    body.tools = toAnthropicTools(options.tools);
  }

  return body;
}

export async function chatAnthropicStream(options: ChatOptions): Promise<ChatResponse> {
  const { apiKey, apiUrl, provider, onToken } = options;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: buildAnthropicHeaders(apiKey, provider),
    body: JSON.stringify(buildAnthropicRequestBody(options, true)),
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
  let stopReason = "";

  const blocks = new Map<
    number,
    {
      type: "text" | "tool_use";
      id: string;
      name: string;
      argumentsText: string;
    }
  >();

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
        type: string;
        index?: number;
        content_block?: {
          type: "text" | "tool_use";
          id?: string;
          name?: string;
        };
        delta?: {
          type: "text_delta" | "input_json_delta";
          text?: string;
          partial_json?: string;
        };
        message?: {
          stop_reason?: string;
        };
      };

      try {
        parsed = JSON.parse(data) as typeof parsed;
      } catch {
        continue;
      }

      if (
        parsed.type === "content_block_start" &&
        parsed.index !== undefined &&
        parsed.content_block
      ) {
        blocks.set(parsed.index, {
          type: parsed.content_block.type,
          id: parsed.content_block.id || "",
          name: parsed.content_block.name || "",
          argumentsText: "",
        });
      }

      if (parsed.type === "content_block_delta" && parsed.index !== undefined && parsed.delta) {
        const block = blocks.get(parsed.index);
        if (parsed.delta.type === "text_delta" && parsed.delta.text) {
          content += parsed.delta.text;
          onToken?.(parsed.delta.text);
        } else if (parsed.delta.type === "input_json_delta" && parsed.delta.partial_json) {
          if (block) {
            block.argumentsText += parsed.delta.partial_json;
          } else {
            blocks.set(parsed.index, {
              type: "tool_use",
              id: "",
              name: "",
              argumentsText: parsed.delta.partial_json,
            });
          }
        }
      }

      if (parsed.type === "message_delta" && parsed.message?.stop_reason) {
        stopReason = parsed.message.stop_reason;
      }
    }
  }

  const toolCalls: ToolCall[] = [];
  for (const block of blocks.values()) {
    if (block.type === "tool_use") {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(block.argumentsText || "{}") as Record<string, unknown>;
      } catch {
        parsedArgs = { raw: block.argumentsText };
      }
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: parsedArgs,
      });
    }
  }

  return {
    content,
    toolCalls,
    finishReason: stopReason || "stop",
  };
}

export async function chatAnthropic(options: ChatOptions): Promise<ChatResponse> {
  const { apiKey, apiUrl, provider } = options;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: buildAnthropicHeaders(apiKey, provider),
    body: JSON.stringify(buildAnthropicRequestBody(options, false)),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    content?: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    >;
    stop_reason?: string;
  };

  let content = "";
  const toolCalls: ToolCall[] = [];

  if (Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input ?? {},
        });
      }
    }
  }

  return {
    content,
    toolCalls,
    finishReason: data.stop_reason ?? "stop",
  };
}
