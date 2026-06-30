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
import { log } from "./utils/logger.ts";

interface AgentCommandOptions {
  model?: string;
  maxIterations: string;
  cwd: string;
  apiKey?: string;
  baseUrl?: string;
  provider: string;
  noStream?: boolean;
}

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
    const cwd = resolve(opts.cwd);
    const { provider, model, baseUrl, apiKey } = resolveAgentConfig(opts);

    log.info(`Provider: ${provider.label}`);
    log.info(`Workspace: ${cwd}`);
    log.info(`Model: ${model}`);

    try {
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
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

  sharedAgentOptions(
    program.command("chat").description("Interactive multi-turn agent session"),
  ).action(async (opts: AgentCommandOptions) => {
    const cwd = resolve(opts.cwd);
    const { provider, model, baseUrl, apiKey } = resolveAgentConfig(opts);
    const rl = readline.createInterface({ input, output });

    log.info(`Provider: ${provider.label}`);
    log.info(`Interactive mode — workspace: ${cwd}`);
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
  });

  return program;
}

export function runCli(argv: string[] = process.argv): void {
  createProgram().parse(argv);
}
