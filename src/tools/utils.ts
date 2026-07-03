import { resolve } from "node:path";

export function assertWithinCwd(cwd: string, targetPath: string): string {
  const resolved = resolve(cwd, targetPath);
  const normalizedCwd = resolve(cwd);

  if (!resolved.startsWith(normalizedCwd)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }

  return resolved;
}
