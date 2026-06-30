import type { Message, Tool, ToolCall } from "../agent/types.ts";
import { resolveChatUrl, type Provider } from "./providers.ts";

interface ChatOptions {
  messages: Message[];
  tools: Tool[];
  model: string;
  apiKey: string;
  baseUrl: string;
  provider?: Provider;
}

interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
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

export async function chat(options: ChatOptions): Promise<ChatResponse> {
  const { messages, tools, model, apiKey, baseUrl, provider } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...provider?.extraHeaders,
  };

  const response = await fetch(resolveChatUrl(baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: toOpenAIMessages(messages),
      tools: toOpenAITools(tools),
      tool_choice: "auto",
    }),
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

  const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((call) => {
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

  return {
    content: choice.message.content ?? "",
    toolCalls,
    finishReason: choice.finish_reason,
  };
}
