import type { Tool } from "../agent/types.ts";
import { createReadFileTool } from "./read_file.ts";
import { createWriteFileTool } from "./write_file.ts";
import { createEditFileTool } from "./edit_file.ts";
import { createListDirectoryTool } from "./list_directory.ts";
import { createSearchFilesTool } from "./search_files.ts";
import { createRunCommandTool } from "./run_command.ts";

export function createTools(cwd: string): Tool[] {
  return [
    createReadFileTool(cwd),
    createWriteFileTool(cwd),
    createEditFileTool(cwd),
    createListDirectoryTool(cwd),
    createSearchFilesTool(cwd),
    createRunCommandTool(cwd),
  ];
}

export function getToolMap(tools: Tool[]): Map<string, Tool> {
  return new Map(tools.map((tool) => [tool.definition.name, tool]));
}
