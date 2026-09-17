import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { listModels } from "libfx";
import { loginLibfx, PROVIDER_ID, resolveApiKey } from "./auth.js";

const DEFAULT_MODELS: Array<{
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}> = [
  {
    id: "google/gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 8192,
  },
  {
    id: "anthropic/claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 16384,
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek R1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 64_000,
    maxTokens: 8192,
  },
];

export function registerLibfxProvider(pi: ExtensionAPI): void {
  pi.registerProvider(PROVIDER_ID, {
    name: "fx (Vercel AI Gateway)",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    apiKey: "$AI_GATEWAY_API_KEY",
    api: "openai-completions",
    oauth: {
      name: "Vercel AI Gateway (fx)",
      login: loginLibfx,
      async refreshToken(credentials: OAuthCredentials, _signal: AbortSignal): Promise<OAuthCredentials> {
        return credentials;
      },
      getApiKey: (credentials: OAuthCredentials) => credentials.access,
    },
    async refreshModels({ signal }: { signal?: AbortSignal }) {
      const apiKey = resolveApiKey();
      if (!apiKey) return DEFAULT_MODELS;

      try {
        const modelIds = await listModels({
          apiKey,
          fetch: globalThis.fetch,
        });

        if (!Array.isArray(modelIds) || modelIds.length === 0) {
          return DEFAULT_MODELS;
        }

        return modelIds.map((id: string) => {
          const lower = id.toLowerCase();
          const reasoning =
            lower.includes("r1") ||
            lower.includes("o1") ||
            lower.includes("o3") ||
            lower.includes("reasoning") ||
            lower.includes("thinking");

          const inputTypes: ("text" | "image")[] = ["text", "image"];

          return {
            id,
            name: id,
            reasoning,
            input: inputTypes,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: lower.includes("gemini") ? 1_000_000 : 128_000,
            maxTokens: 8192,
          };
        });
      } catch {
        return DEFAULT_MODELS;
      }
    },
    models: DEFAULT_MODELS,
  });
}
