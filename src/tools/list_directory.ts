import type { Tool } from "../agent/types.ts";
import { assertWithinCwd } from "./utils.ts";

/** Folders that are always excluded to keep the output clean and focused. */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  ".turbo",
  ".cache",
]);

export function createListDirectoryTool(cwd: string): Tool {
  return {
    definition: {
      name: "list_directory",
      description:
        "List files and directories at a path relative to the workspace root. Common build/dependency folders (node_modules, .git, dist, etc.) are excluded automatically.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative directory path (use '.' for workspace root)",
          },
        },
        required: ["path"],
      },
    },
    execute: async (args) => {
      const dirPath = assertWithinCwd(cwd, String(args.path));
      const glob = new Bun.Glob("**/*");
      const entries: string[] = [];

      for await (const entry of glob.scan({
        cwd: dirPath,
        onlyFiles: false,
        dot: false,
      })) {
        // Skip entries whose first path segment is an excluded directory
        const topSegment = entry.split(/[\\/]/)[0];
        if (topSegment && EXCLUDED_DIRS.has(topSegment)) continue;

        entries.push(entry);
        if (entries.length >= 200) break;
      }

      if (entries.length === 0) {
        return `Directory is empty or all contents are excluded: ${args.path}`;
      }

      return entries.join("\n");
    },
  };
}
