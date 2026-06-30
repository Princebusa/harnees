import { chat } from "../llm/client.ts";
import { createTools, getToolMap } from "../tools/index.ts";
import { log } from "../utils/logger.ts";
import type { AgentLoopOptions, AgentLoopResult, Message } from "./types.ts";

const DEFAULT_SYSTEM_PROMPT = `You are a coding agent running in a CLI environment.
You have tools to read/write files, list directories, search code, and run shell commands.

Rules:
- Explore the codebase before making changes.
- Prefer minimal, focused edits.
- Run relevant commands (tests, typecheck) when appropriate.
- When the task is complete, reply with a concise summary of what you did.
- Do not ask the user questions unless truly blocked.`;

export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    task,
    cwd,
    maxIterations,
    model,
    apiKey,
    baseUrl,
    provider,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    onIteration,
    onToolCall,
    onToolResult,
  } = options;

  const tools = createTools(cwd);
  const toolMap = getToolMap(tools);

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    log.dim(`--- iteration ${iteration}/${maxIterations} ---`);

    const response = await chat({
      messages,
      tools,
      model,
      apiKey,
      baseUrl,
      provider,
    });

    const assistantMessage: Message = {
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
    };

    messages.push(assistantMessage);
    onIteration?.(iteration, assistantMessage);

    if (response.content) {
      log.agent(response.content);
    }

    if (response.toolCalls.length === 0) {
      return {
        finalMessage: response.content,
        iterations: iteration,
        messages,
      };
    }

    for (const toolCall of response.toolCalls) {
      onToolCall?.(toolCall.name, toolCall.arguments);
      log.tool(toolCall.name, JSON.stringify(toolCall.arguments));

      const tool = toolMap.get(toolCall.name);
      let result: string;

      if (!tool) {
        result = `Error: unknown tool "${toolCall.name}"`;
      } else {
        try {
          result = await tool.execute(toolCall.arguments);
        } catch (error) {
          result = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      onToolResult?.(toolCall.name, result);
      log.dim(result.slice(0, 200) + (result.length > 200 ? "..." : ""));

      messages.push({
        role: "tool",
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: result,
      });
    }
  }

  throw new Error(`Agent stopped after ${maxIterations} iterations without finishing`);
}
