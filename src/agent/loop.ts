import { chat } from "../providers/client.ts";
import { createTools, getToolMap } from "../tools/index.ts";
import { log } from "../utils/logger.ts";
import {
  appendWorkspaceMemory,
  compactAgentMessages,
  loadWorkspaceMemory,
  trimSessionHistory,
} from "./memory.ts";
import type { AgentLoopOptions, AgentLoopResult, Message } from "./types.ts";

const DEFAULT_SYSTEM_PROMPT = `You are a coding agent running in a CLI environment.
You have tools to read/write files, list directories, search code, and run shell commands.

Tools available:
- read_file: Read an existing file
- write_file: Create a new file or fully overwrite an existing one
- edit_file: Edit a specific section of an existing file via search-and-replace (PREFERRED for modifying existing files)
- list_directory: List directory contents (excludes node_modules, .git, dist, etc.)
- search_files: Search for a regex pattern across workspace files
- run_command: Run a shell command (build, test, git, etc.)

Rules:
- Explore the codebase before making changes.
- Prefer edit_file over write_file when modifying existing files.
- Use write_file only for brand-new files or when a full rewrite is truly necessary.
- Run relevant commands (tests, typecheck) when appropriate.
- When the task is complete, reply with a concise summary of what you did.
- Do not ask the user questions unless truly blocked.
- In chat mode, prior turns in this session are included in context; use them to stay consistent.
- For facts that should persist across future sessions, suggest updating .harnees/memory.md in the workspace.`;

export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    task,
    cwd,
    maxIterations,
    model,
    apiKey,
    apiUrl,
    provider,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    history = [],
    maxContextChars,
    onIteration,
    onToolCall,
    onToolResult,
    onToken,
    stream = true,
  } = options;

  const tools = createTools(cwd);
  const toolMap = getToolMap(tools);

  const workspaceMemory = await loadWorkspaceMemory(cwd);
  const sessionHistory = trimSessionHistory(history);
  const systemContent = appendWorkspaceMemory(systemPrompt, workspaceMemory);

  const messages: Message[] = [
    { role: "system", content: systemContent },
    ...sessionHistory,
    { role: "user", content: task },
  ];
  const taskMessageIndex = messages.length - 1;

  if (sessionHistory.length > 0) {
    log.dim(`Session memory: ${sessionHistory.length / 2} prior turn(s)`);
  }
  if (workspaceMemory) {
    log.dim("Loaded workspace memory from project notes");
  }

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    log.dim(`--- iteration ${iteration}/${maxIterations} ---`);

    const contextMessages = compactAgentMessages(
      messages,
      taskMessageIndex,
      maxContextChars,
    );

    let streamed = false;
    const response = await chat({
      messages: contextMessages,
      tools,
      model,
      apiKey,
      apiUrl,
      provider,
      onToken: stream
        ? (chunk) => {
            streamed = true;
            onToken?.(chunk);
          }
        : undefined,
    });

    const assistantMessage: Message = {
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
    };

    messages.push(assistantMessage);
    onIteration?.(iteration, assistantMessage);

    if (streamed) {
      log.write("\n");
    } else if (response.content) {
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