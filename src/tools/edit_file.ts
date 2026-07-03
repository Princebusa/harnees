import type { Tool } from "../agent/types.ts";
import { assertWithinCwd } from "./utils.ts";

export function createEditFileTool(cwd: string): Tool {
  return {
    definition: {
      name: "edit_file",
      description: `Edit a file by replacing an exact block of text with new content.
Use this instead of write_file when modifying an existing file — it is token-efficient and safe.

Rules:
- oldContent MUST exactly match the text in the file, including whitespace and indentation.
- oldContent must be unique within the file. If it matches multiple locations, the tool returns an error.
- Use write_file only for creating brand-new files or intentionally rewriting a file in full.`,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path to the file to edit",
          },
          oldContent: {
            type: "string",
            description: "The exact text block to search for and replace. Must match exactly once in the file.",
          },
          newContent: {
            type: "string",
            description: "The replacement text that will take the place of oldContent.",
          },
        },
        required: ["path", "oldContent", "newContent"],
      },
    },
    execute: async (args) => {
      const filePath = assertWithinCwd(cwd, String(args.path));
      const oldContent = String(args.oldContent);
      const newContent = String(args.newContent);

      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        return `Error: file not found: ${args.path}`;
      }

      const original = await file.text();

      const occurrences = countOccurrences(original, oldContent);

      if (occurrences === 0) {
        return [
          `Error: oldContent not found in ${args.path}.`,
          `Make sure your oldContent exactly matches the file text, including whitespace and indentation.`,
          `Tip: use read_file to inspect the current file content before editing.`,
        ].join("\n");
      }

      if (occurrences > 1) {
        return [
          `Error: oldContent matches ${occurrences} locations in ${args.path}.`,
          `Provide a more specific (longer) oldContent block that uniquely identifies the target section.`,
        ].join("\n");
      }

      const updated = original.replace(oldContent, newContent);
      await Bun.write(filePath, updated);

      const linesBefore = original.split("\n").length;
      const linesAfter = updated.split("\n").length;
      const delta = linesAfter - linesBefore;
      const sign = delta >= 0 ? "+" : "";

      return `Edited ${args.path} (${sign}${delta} lines, ${updated.length} bytes total)`;
    },
  };
}

/** Count non-overlapping occurrences of needle in haystack. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}
