import type { Provider } from "../providers/index.ts";

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Message {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: string[];
      }
    >;
    required: string[];
  };
}

export interface Tool {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface AgentLoopOptions {
  task: string;
  cwd: string;
  maxIterations: number;
  model: string;
  apiKey: string;
  apiUrl: string;
  provider?: Provider;
  systemPrompt?: string;
  onIteration?: (iteration: number, message: Message) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string) => void;
  onToken?: (chunk: string) => void;
  stream?: boolean;
}

export interface AgentLoopResult {
  finalMessage: string;
  iterations: number;
  messages: Message[];
}
