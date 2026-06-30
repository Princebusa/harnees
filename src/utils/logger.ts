const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const cyan = (text: string) => `\x1b[36m${text}\x1b[0m`;
const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;

export const log = {
  info: (msg: string) => console.log(cyan("ℹ"), msg),
  success: (msg: string) => console.log(green("✓"), msg),
  warn: (msg: string) => console.log(yellow("⚠"), msg),
  error: (msg: string) => console.error(red("✗"), msg),
  dim: (msg: string) => console.log(dim(msg)),
  agent: (msg: string) => console.log(cyan("agent"), msg),
  tool: (name: string, detail?: string) =>
    console.log(yellow("tool"), name, detail ? dim(detail) : ""),
};
