import { join, resolve } from "node:path";
import type { Tool } from "../agent/types.ts";

function assertWithinCwd(cwd: string, targetPath: string): string {
  const resolved = resolve(cwd, targetPath);
  const normalizedCwd = resolve(cwd);

  if (!resolved.startsWith(normalizedCwd)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }

  return resolved;
}

export function createFilesystemTools(cwd: string): Tool[] {
  return [
    {
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
    },
    {
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
        await Bun.write(filePath, String(args.content));
        return `Wrote ${args.path} (${String(args.content).length} bytes)`;
      },
    },
    {
      definition: {
        name: "list_directory",
        description: "List files and directories at a path relative to the workspace root.",
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
          entries.push(entry);
          if (entries.length >= 200) break;
        }

        if (entries.length === 0) {
          return `Directory is empty: ${args.path}`;
        }

        return entries.join("\n");
      },
    },
    {
      definition: {
        name: "search_files",
        description: "Search for a regex pattern in files under the workspace.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "Regex pattern to search for",
            },
            glob: {
              type: "string",
              description: "Optional glob filter, e.g. '*.ts'",
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
          const fullPath = join(cwd, relativePath);
          const file = Bun.file(fullPath);

          if (!(await file.exists())) continue;

          const stat = await file.stat();
          if (stat.size > 512_000) continue;

          const content = await file.text();
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i]!)) {
              matches.push(`${relativePath}:${i + 1}: ${lines[i]!.trim()}`);
              if (matches.length >= 50) {
                return matches.join("\n");
              }
            }
          }
        }

        return matches.length > 0
          ? matches.join("\n")
          : `No matches for pattern: ${pattern}`;
      },
    },
  ];
}
