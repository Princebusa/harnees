export interface FreeModel {
  id: string;
  name: string;
  note?: string;
}

export interface Provider {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  apiKeyEnvVars: string[];
  freeModels: FreeModel[];
  extraHeaders?: Record<string, string>;
}

/** OpenRouter free-tier models (IDs end with :free). Get a key at https://openrouter.ai/keys */
export const OPENROUTER_FREE_MODELS: FreeModel[] = [
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B",
    note: "Strong general + coding; good default",
  },
  // {
  //   id: "qwen/qwen-2.5-coder-32b-instruct:free",
  //   name: "Qwen 2.5 Coder 32B",
  //   note: "Best free option for code tasks",
  // },
  {
    id: "google/gemma-2-9b-it:free",
    name: "Gemma 2 9B",
    note: "Fast, lighter workloads",
  },
  {
    id: "mistralai/mistral-7b-instruct:free",
    name: "Mistral 7B",
    note: "Fast, basic tasks",
  },
  {
    id: "meta-llama/llama-3.2-3b-instruct:free",
    name: "Llama 3.2 3B",
    note: "Smallest; quick smoke tests",
  },
];

export const PROVIDERS: Record<string, Provider> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter (free models available)",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
    apiKeyEnvVars: ["OPENROUTER_API_KEY"],
    freeModels: OPENROUTER_FREE_MODELS,
    extraHeaders: {
      "HTTP-Referer": "https://github.com/harnees-agent",
      "X-Title": "harnees",
    },
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    apiKeyEnvVars: ["OPENAI_API_KEY"],
    freeModels: [],
  },
};

export const DEFAULT_PROVIDER = "openrouter";

export function getProvider(id: string): Provider {
  const provider = PROVIDERS[id];
  if (!provider) {
    const available = Object.keys(PROVIDERS).join(", ");
    throw new Error(`Unknown provider "${id}". Available: ${available}`);
  }
  return provider;
}

export function resolveApiKey(provider: Provider, explicit?: string): string {
  if (explicit) return explicit;

  for (const envVar of provider.apiKeyEnvVars) {
    const value = process.env[envVar];
    if (value) return value;
  }

  const envHint = provider.apiKeyEnvVars.join(" or ");
  throw new Error(
    `Missing API key for ${provider.label}. Set ${envHint} or pass --api-key.\n` +
      (provider.id === "openrouter"
        ? "Get a free key at https://openrouter.ai/keys"
        : ""),
  );
}

export function resolveChatUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}
