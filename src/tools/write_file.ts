import type { Tool } from "../agent/types.ts";
import { assertWithinCwd } from "./utils.ts";

export function createWriteFileTool(cwd: string): Tool {
  return {
    definition: {
      name: "write_file",
      description: "Write content to a file, creating parent directories if needed.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path to the file",
          },
          content: {
            type: "string",
            description: "Full file content to write",
          },
        },
        required: ["path", "content"],
      },
    },
    execute: async (args) => {
      const filePath = assertWithinCwd(cwd, String(args.path));
      // Bun.write will automatically create parent directories if needed
      await Bun.write(filePath, String(args.content));
      return `Wrote ${args.path} (${String(args.content).length} bytes)`;
    },
  };
}
