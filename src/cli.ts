import * as p from "@clack/prompts";
import { Command } from "commander";
import { resolve } from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runAgentLoop } from "./agent/loop.ts";
import {
  DEFAULT_PROVIDER,
  getProvider,
  OPENROUTER_FREE_MODELS,
  PROVIDERS,
  resolveApiKey,
} from "./llm/providers.ts";
import { runPlainChat } from "./modes/plain.ts";
import { log } from "./utils/logger.ts";

export interface AgentCommandOptions {
  model?: string;
  maxIterations: string;
  cwd: string;
  apiKey?: string;
  baseUrl?: string;
  provider: string;
  noStream?: boolean;
}

const SUBCOMMANDS = new Set(["run", "chat", "models", "help"]);
const HELP_FLAGS = new Set(["-h", "--help", "-V", "--version"]);

type AppMode = "agent" | "chat" | "plain";

function createStreamHandler(prefix: string) {
  let started = false;

  return (chunk: string) => {
    if (!started) {
      log.write(prefix);
      started = true;
    }
    log.write(chunk);
  };
}

function resolveAgentConfig(opts: AgentCommandOptions) {
  const provider = getProvider(opts.provider);
  const model = opts.model ?? provider.defaultModel;
  const baseUrl = opts.baseUrl ?? provider.baseUrl;
  const apiKey = resolveApiKey(provider, opts.apiKey);

  return { provider, model, baseUrl, apiKey };
}

function sharedAgentOptions(command: Command): Command {
  return command
    .option(
      "-p, --provider <name>",
      `LLM provider (${Object.keys(PROVIDERS).join(", ")})`,
      DEFAULT_PROVIDER,
    )
    .option("-m, --model <model>", "Model id (defaults to provider's free/paid default)")
    .option("-i, --max-iterations <n>", "Max agent loop iterations", "25")
    .option("-c, --cwd <path>", "Workspace directory", process.cwd())
    .option("--api-key <key>", "API key (or set provider env var, e.g. OPENROUTER_API_KEY)")
    .option("--base-url <url>", "Override API base URL")
    .option("--no-stream", "Disable token streaming (wait for full response)");
}

function parseSharedOptions(args: string[]): AgentCommandOptions {
  const cmd = new Command();
  sharedAgentOptions(cmd);
  cmd.parse(args, { from: "user" });
  return cmd.opts() as AgentCommandOptions;
}

function shouldShowInteractiveMenu(args: string[]): boolean {
  if (args.length === 0) return true;
  if (args.some((arg) => SUBCOMMANDS.has(arg) || HELP_FLAGS.has(arg))) return false;
  return args.every((arg) => arg.startsWith("-"));
}

async function runAgentTask(opts: AgentCommandOptions, task: string): Promise<void> {
  const cwd = resolve(opts.cwd);
  const { provider, model, baseUrl, apiKey } = resolveAgentConfig(opts);

  log.info(`Provider: ${provider.label}`);
  log.info(`Workspace: ${cwd}`);
  log.info(`Model: ${model}`);

  const stream = !opts.noStream;
  const onToken = stream ? createStreamHandler("\x1b[36magent\x1b[0m ") : undefined;

  const result = await runAgentLoop({
    task,
    cwd,
    model,
    apiKey,
    baseUrl,
    provider,
    maxIterations: Number.parseInt(opts.maxIterations, 10),
    stream,
    onToken,
  });

  log.success(`Done in ${result.iterations} iteration(s)`);
  if (!stream) {
    console.log("\n" + result.finalMessage);
  }
}

async function runChatSession(opts: AgentCommandOptions): Promise<void> {
  const cwd = resolve(opts.cwd);
  const { provider, model, baseUrl, apiKey } = resolveAgentConfig(opts);
  const rl = readline.createInterface({ input, output });

  log.info(`Provider: ${provider.label}`);
  log.info(`Chat mode — workspace: ${cwd}`);
  log.info(`Model: ${model}`);
  log.info(`Type 'exit' or Ctrl+C to quit\n`);

  try {
    while (true) {
      const task = await rl.question("you> ");
      const trimmed = task.trim();

      if (!trimmed) continue;
      if (trimmed.toLowerCase() === "exit") break;

      try {
        const stream = !opts.noStream;
        const onToken = stream ? createStreamHandler("\nagent> ") : undefined;

        const result = await runAgentLoop({
          task: trimmed,
          cwd,
          model,
          apiKey,
          baseUrl,
          provider,
          maxIterations: Number.parseInt(opts.maxIterations, 10),
          stream,
          onToken,
        });

        if (!stream) {
          console.log("\nagent>", result.finalMessage, "\n");
        } else {
          console.log();
        }
      } catch (error) {
        log.error(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    rl.close();
  }
}

async function runPlainSession(opts: AgentCommandOptions): Promise<void> {
  const { provider, model, baseUrl, apiKey } = resolveAgentConfig(opts);
  const stream = !opts.noStream;
  const onToken = stream ? createStreamHandler("\nassistant> ") : undefined;

  await runPlainChat({
    model,
    apiKey,
    baseUrl,
    provider,
    stream,
    onToken,
  });
}

async function runInteractiveMenu(opts: AgentCommandOptions): Promise<void> {
  p.intro("harnees");

  const mode = await p.select<AppMode>({
    message: "What would you like to do?",
    options: [
      {
        value: "agent",
        label: "Agent mode",
        hint: "run a single coding task with tools",
      },
      {
        value: "chat",
        label: "Chat mode",
        hint: "multi-turn agent session with tools",
      },
      {
        value: "plain",
        label: "Plain mode",
        hint: "direct LLM chat, no tools",
      },
    ],
  });

  if (p.isCancel(mode)) {
    p.cancel("Goodbye.");
    process.exit(0);
  }

  p.outro(`Starting ${mode} mode`);

  try {
    switch (mode) {
      case "agent": {
        const task = await p.text({
          message: "What should the agent do?",
          placeholder: "e.g. add a README with setup instructions",
        });

        if (p.isCancel(task)) {
          p.cancel("Goodbye.");
          process.exit(0);
        }

        await runAgentTask(opts, task);
        break;
      }
      case "chat":
        await runChatSession(opts);
        break;
      case "plain":
        await runPlainSession(opts);
        break;
    }
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function createProgram(): Command {
  const program = new Command();

  program
    .name("harnees")
    .description("CLI coding agent with tool-use loop")
    .version("0.1.0");

  program
    .command("models")
    .description("List free OpenRouter models you can use with --model")
    .action(() => {
      console.log("Free OpenRouter models (use with --provider openrouter --model <id>):\n");
      for (const model of OPENROUTER_FREE_MODELS) {
        console.log(`  ${model.id}`);
        console.log(`    ${model.name}${model.note ? ` — ${model.note}` : ""}\n`);
      }
      console.log("Get a free API key: https://openrouter.ai/keys");
      console.log(`Then: $env:OPENROUTER_API_KEY = "sk-or-..."`);
    });

  sharedAgentOptions(
    program
      .command("run")
      .description("Run the agent on a single task")
      .argument("<task>", "Task for the agent to complete"),
  ).action(async (task: string, opts: AgentCommandOptions) => {
    try {
      await runAgentTask(opts, task);
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

  sharedAgentOptions(
    program.command("chat").description("Interactive multi-turn agent session"),
  ).action(async (opts: AgentCommandOptions) => {
    try {
      await runChatSession(opts);
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

  sharedAgentOptions(
    program.command("plain").description("Interactive LLM chat without tools"),
  ).action(async (opts: AgentCommandOptions) => {
    try {
      await runPlainSession(opts);
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const args = argv.slice(2);

  if (shouldShowInteractiveMenu(args)) {
    const opts = parseSharedOptions(args);
    await runInteractiveMenu(opts);
    return;
  }

  createProgram().parse(argv);
}
