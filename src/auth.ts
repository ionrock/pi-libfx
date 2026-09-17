import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const PROVIDER_ID = "libfx";
export const ENV_API_KEY = "AI_GATEWAY_API_KEY";

/**
 * Resolves the Gateway API key from the environment or stored Pi credentials.
 */
export function resolveApiKey(storedKey?: string): string | undefined {
  if (process.env[ENV_API_KEY] && process.env[ENV_API_KEY].trim().length > 0) {
    return process.env[ENV_API_KEY].trim();
  }
  if (storedKey && storedKey.trim().length > 0) {
    return storedKey.trim();
  }

  // Check stored credentials in ~/.pi/agent/auth.json
  try {
    let agentDir: string;
    try {
      agentDir = getAgentDir();
    } catch {
      agentDir = join(homedir(), ".pi", "agent");
    }

    const authPath = join(agentDir, "auth.json");
    if (existsSync(authPath)) {
      const data = JSON.parse(readFileSync(authPath, "utf8"));
      // 1. Check libfx entry (oauth or api_key)
      if (data && data[PROVIDER_ID]) {
        const entry = data[PROVIDER_ID];
        const val = entry.access || entry.key || (typeof entry === "string" ? entry : undefined);
        if (typeof val === "string" && val.trim().length > 0) {
          return val.trim();
        }
      }
      // 2. Check standard Pi vercel-ai-gateway entry
      if (data && data["vercel-ai-gateway"]) {
        const entry = data["vercel-ai-gateway"];
        const val = entry.key || entry.access || (typeof entry === "string" ? entry : undefined);
        if (typeof val === "string" && val.trim().length > 0) {
          return val.trim();
        }
      }
    }
  } catch {}

  return undefined;
}

/**
 * Interactive login flow triggered when the user runs `/login libfx`.
 */
export async function loginLibfx(
  callbacks: OAuthLoginCallbacks
): Promise<{ access: string; refresh: string; expires: number }> {
  callbacks.onProgress?.("Authenticating with Vercel AI Gateway...");

  const key = await callbacks.onPrompt({
    message: "Enter your Vercel AI Gateway API key (AI_GATEWAY_API_KEY):",
  });

  if (!key || key.trim().length === 0) {
    throw new Error("No API key provided. Login cancelled.");
  }

  const trimmed = key.trim();
  // Vercel AI Gateway API keys are long-lived tokens
  return {
    access: trimmed,
    refresh: trimmed,
    expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
  };
}
