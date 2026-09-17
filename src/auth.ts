import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai";

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
