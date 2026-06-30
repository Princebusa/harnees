import type { Tool } from "../agent/types.ts";
import { createFilesystemTools } from "./filesystem.ts";
import { createShellTool } from "./shell.ts";

export function createTools(cwd: string): Tool[] {
  return [...createFilesystemTools(cwd), createShellTool(cwd)];
}

export function getToolMap(tools: Tool[]): Map<string, Tool> {
  return new Map(tools.map((tool) => [tool.definition.name, tool]));
}
