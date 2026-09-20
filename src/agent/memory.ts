import { join } from "node:path";
import type { Message } from "./types.ts";

export const WORKSPACE_MEMORY_FILES = [
  ".harnees/memory.md",
  ".harnees/MEMORY.md",
  "HARNEES.md",
] as const;

const DEFAULT_MAX_CONTEXT_CHARS = 120_000;
const DEFAULT_MAX_SESSION_TURNS = 12;
const RECENT_FULL_TOOL_MESSAGES = 8;
const COMPACTED_TOOL_CHARS = 2_000;

export async function loadWorkspaceMemory(
  cwd: string,
): Promise<string | undefined> {
  for (const rel of WORKSPACE_MEMORY_FILES) {
    const filePath = join(cwd, rel);
    const file = Bun.file(filePath);
    if (!(await file.exists())) continue;

    const text = (await file.text()).trim();
    if (text) return text;
  }
  return undefined;
}

export function appendWorkspaceMemory(
  systemPrompt: string,
  workspaceMemory: string | undefined,
): string {
  if (!workspaceMemory) return systemPrompt;
  return `${systemPrompt}\n\n## Workspace memory\n\nThe following notes were saved for this project. Treat them as reliable context unless the codebase contradicts them.\n\n${workspaceMemory}`;
}

export function estimateMessagesChars(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += msg.content.length;
    if (msg.toolCalls) {
      total += JSON.stringify(msg.toolCalls).length;
    }
  }
  return total;
}

export function truncateForContext(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const omitted = content.length - maxChars;
  return `${content.slice(0, maxChars)}\n... (${omitted} chars truncated)`;
}

/** Keep the most recent user/assistant turns within a character budget. */
export function trimSessionHistory(
  history: Message[],
  maxTurns = DEFAULT_MAX_SESSION_TURNS,
  maxChars = 24_000,
): Message[] {
  if (history.length === 0) return history;

  const turns: Message[][] = [];
  for (let i = 0; i < history.length; i += 2) {
    const user = history[i];
    const assistant = history[i + 1];
    if (user?.role !== "user" || assistant?.role !== "assistant") continue;
    turns.push([user, assistant]);
  }

  const kept: Message[] = [];
  let chars = 0;

  for (const turn of turns.slice(-maxTurns).reverse()) {
    const turnChars = turn[0]!.content.length + turn[1]!.content.length;
    if (kept.length > 0 && chars + turnChars > maxChars) break;
    kept.unshift(...turn);
    chars += turnChars;
  }

  return kept;
}

/**
 * Shrink tool outputs from earlier in the current task so the model keeps
 * recent detail without blowing the context window.
 */
export function compactAgentMessages(
  messages: Message[],
  taskMessageIndex: number,
  maxChars = DEFAULT_MAX_CONTEXT_CHARS,
): Message[] {
  if (estimateMessagesChars(messages) <= maxChars) {
    return messages;
  }

  const head = messages.slice(0, taskMessageIndex + 1);
  const tail = messages.slice(taskMessageIndex + 1);

  const toolIndices: number[] = [];
  for (let i = 0; i < tail.length; i++) {
    if (tail[i]!.role === "tool") toolIndices.push(i);
  }

  const compactTail = tail.map((msg, index) => {
    if (msg.role !== "tool") return msg;

    const toolOrder = toolIndices.indexOf(index);
    const toolsFromEnd = toolIndices.length - 1 - toolOrder;
    if (toolsFromEnd < RECENT_FULL_TOOL_MESSAGES) return msg;

    if (msg.content.length <= COMPACTED_TOOL_CHARS) return msg;
    return {
      ...msg,
      content: truncateForContext(msg.content, COMPACTED_TOOL_CHARS),
    };
  });

  let result = [...head, ...compactTail];
  if (estimateMessagesChars(result) <= maxChars) {
    return result;
  }

  // Still too large: compact all but the most recent tool results.
  const aggressiveTail = compactTail.map((msg, index) => {
    if (msg.role !== "tool") return msg;
    if (index === compactTail.length - 1) return msg;
    if (msg.content.length <= 800) return msg;
    return {
      ...msg,
      content: truncateForContext(msg.content, 800),
    };
  });

  result = [...head, ...aggressiveTail];
  return result;
}
