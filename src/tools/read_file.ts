import type { Tool } from "../agent/types.ts";
import { assertWithinCwd } from "./utils.ts";

export function createReadFileTool(cwd: string): Tool {
  return {
    definition: {
      name: "read_file",
      description: "Read the contents of a file relative to the workspace root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path to the file",
          },
        },
        required: ["path"],
      },
    },
    execute: async (args) => {
      const filePath = assertWithinCwd(cwd, String(args.path));
      const file = Bun.file(filePath);

      if (!(await file.exists())) {
        return `Error: file not found: ${args.path}`;
      }

      const content = await file.text();
      return content.length > 12000
        ? `${content.slice(0, 12000)}\n... (truncated)`
        : content;
    },
  };
}
