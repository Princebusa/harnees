import type { Provider, ResolvedProviderConfig, FreeModel } from "./types.ts";

/** OpenRouter free-tier model. */
export const OPENROUTER_FREE_MODELS: FreeModel[] = [
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B",
    note: "Strong general + coding; good default",
  },
];

export const PROVIDERS: Record<string, Provider> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    endpoint: "chat/completions",
    apiStyle: "openai-chat",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
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
    endpoint: "chat/completions",
    apiStyle: "openai-chat",
    defaultModel: "gpt-4o-mini",
    apiKeyEnvVars: ["OPENAI_API_KEY"],
    freeModels: [],
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    endpoint: "messages",
    apiStyle: "anthropic-chat",
    defaultModel: "claude-3-5-sonnet-latest",
    apiKeyEnvVars: ["ANTHROPIC_API_KEY"],
    freeModels: [],
    extraHeaders: {
      "anthropic-version": "2023-06-01",
    },
  },
  ollama: {
    id: "ollama",
    label: "Ollama (local, free, no API key)",
    baseUrl: "http://localhost:11434",
    endpoint: "api/chat",
    apiStyle: "ollama-chat",
    defaultModel: "llama3.2",
    apiKeyEnvVars: [],
    apiKeyOptional: true,
    freeModels: [],
  },
};

export const DEFAULT_PROVIDER = "openrouter";

const COMPLETE_ENDPOINT_PATTERN =
  /\/(chat\/completions|completions|messages|api\/chat|generate)(\?|$)/;

export function isCompleteEndpointUrl(url: string): boolean {
  return COMPLETE_ENDPOINT_PATTERN.test(url.replace(/\/$/, ""));
}

export function resolveApiUrl(baseUrl: string, endpoint: string): string {
  const base = baseUrl.replace(/\/$/, "");

  if (isCompleteEndpointUrl(base)) {
    return base;
  }

  const path = endpoint.replace(/^\//, "");
  if (!path) {
    return base;
  }

  if (base.endsWith(`/${path}`)) {
    return base;
  }

  return `${base}/${path}`;
}

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

  if (provider.apiKeyOptional) {
    return "";
  }

  const envHint = provider.apiKeyEnvVars.join(" or ");
  throw new Error(
    `Missing API key for ${provider.label}. Set ${envHint} or pass --api-key.\n` +
      (provider.id === "openrouter"
        ? "Get a free key at https://openrouter.ai/keys"
        : ""),
  );
}

export function resolveProviderConfig(
  providerId: string,
  opts: {
    model?: string;
    baseUrl?: string;
    endpoint?: string;
    apiKey?: string;
  },
): ResolvedProviderConfig {
  const provider = getProvider(providerId);
  const baseUrl = opts.baseUrl ?? provider.baseUrl;
  const endpoint = opts.endpoint ?? provider.endpoint;

  return {
    provider,
    apiUrl: resolveApiUrl(baseUrl, endpoint),
    model: opts.model ?? provider.defaultModel,
    apiKey: resolveApiKey(provider, opts.apiKey),
  };
}
