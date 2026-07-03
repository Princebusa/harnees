import { join } from "node:path";
import type { Tool } from "../agent/types.ts";

/** Folders to skip during search to avoid noise from generated/dependency code. */
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

export function createSearchFilesTool(cwd: string): Tool {
  return {
    definition: {
      name: "search_files",
      description:
        "Search for a regex pattern across files in the workspace. Returns matching file paths and line numbers. Common build/dependency folders are excluded automatically.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to search for",
          },
          glob: {
            type: "string",
            description: "Optional glob filter, e.g. '*.ts' or 'src/**/*.ts'",
          },
        },
        required: ["pattern"],
      },
    },
    execute: async (args) => {
      const pattern = String(args.pattern);
      const globPattern = args.glob ? String(args.glob) : "**/*";
      const regex = new RegExp(pattern, "i");
      const fileGlob = new Bun.Glob(globPattern);
      const matches: string[] = [];

      for await (const relativePath of fileGlob.scan({
        cwd,
        onlyFiles: true,
        dot: false,
      })) {
        // Skip excluded top-level directories
        const topSegment = relativePath.split(/[\\/]/)[0];
        if (topSegment && EXCLUDED_DIRS.has(topSegment)) continue;

        const fullPath = join(cwd, relativePath);
        const file = Bun.file(fullPath);

        if (!(await file.exists())) continue;

        const stat = await file.stat();
        if (stat.size > 512_000) continue; // skip very large files

        const content = await file.text();
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i]!)) {
            matches.push(`${relativePath}:${i + 1}: ${lines[i]!.trim()}`);
            if (matches.length >= 50) {
              return matches.join("\n") + "\n... (limit reached, refine your pattern)";
            }
          }
        }
      }

      return matches.length > 0
        ? matches.join("\n")
        : `No matches for pattern: ${pattern}`;
    },
  };
}
