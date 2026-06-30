import type { Tool } from "../agent/types.ts";

const BLOCKED = [
  "rm -rf /",
  "format ",
  "mkfs",
  ":(){ :|:& };:",
];

export function createShellTool(cwd: string): Tool {
  return {
    definition: {
      name: "run_command",
      description:
        "Run a shell command in the workspace directory. Use for builds, tests, git status, etc.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command to execute",
          },
        },
        required: ["command"],
      },
    },
    execute: async (args) => {
      const command = String(args.command).trim();

      for (const blocked of BLOCKED) {
        if (command.includes(blocked)) {
          return `Error: blocked command pattern detected`;
        }
      }

      const proc = Bun.spawn(["powershell", "-NoProfile", "-Command", command], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const exitCode = await proc.exited;
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();

      if (exitCode !== 0) {
        return `Exit code ${exitCode}\n${output || "(no output)"}`;
      }

      const truncated =
        output.length > 8000 ? `${output.slice(0, 8000)}\n... (truncated)` : output;

      return truncated || "(command completed with no output)";
    },
  };
}
