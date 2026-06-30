import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Message } from "../agent/types.ts";
import { chat } from "../llm/client.ts";
import type { Provider } from "../llm/providers.ts";
import { log } from "../utils/logger.ts";

const PLAIN_SYSTEM_PROMPT =
  "You are a helpful assistant. Answer clearly and concisely.";

export interface PlainChatOptions {
  model: string;
  apiKey: string;
  baseUrl: string;
  provider?: Provider;
  stream?: boolean;
  onToken?: (chunk: string) => void;
}

export async function runPlainChat(options: PlainChatOptions): Promise<void> {
  const { model, apiKey, baseUrl, provider, stream = true, onToken } = options;
  const messages: Message[] = [{ role: "system", content: PLAIN_SYSTEM_PROMPT }];
  const rl = readline.createInterface({ input, output });

  log.info("Plain mode — direct LLM chat, no tools");
  log.info(`Model: ${model}`);
  log.info("Type 'exit' or Ctrl+C to quit\n");

  try {
    while (true) {
      const line = await rl.question("you> ");
      const trimmed = line.trim();

      if (!trimmed) continue;
      if (trimmed.toLowerCase() === "exit") break;

      messages.push({ role: "user", content: trimmed });

      try {
        let streamed = false;

        const response = await chat({
          messages,
          model,
          apiKey,
          baseUrl,
          provider,
          onToken: stream
            ? (chunk) => {
                streamed = true;
                onToken?.(chunk);
              }
            : undefined,
        });

        messages.push({ role: "assistant", content: response.content });

        if (streamed) {
          log.write("\n\n");
        } else if (response.content) {
          console.log("\nassistant>", response.content, "\n");
        }
      } catch (error) {
        log.error(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    rl.close();
  }
}
