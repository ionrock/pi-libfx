export interface LibfxConfig {
  /** Gateway API key (defaults to AI_GATEWAY_API_KEY environment variable) */
  apiKey?: string;
  /** Custom Gateway chat URL override */
  gatewayChatUrl?: string;
  /** Active backend execution mode: auto (prefer native), native, or wasm */
  backend: "auto" | "native" | "wasm";
  /** Whether the full native Zig agent loop is active (intercepts input) */
  nativeKernel: boolean;
  /** Default model ID to use when none is explicitly selected */
  defaultModel: string;
}

export interface LibfxBackendStatus {
  backend: "native" | "wasm-jspi" | "unavailable";
  platform: string;
  arch: string;
  nativeAddonAvailable: boolean;
  attempts: Array<{
    backend: string;
    available: boolean;
    reason?: { code?: string; message?: string };
  }>;
}

export interface FxToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, context: { signal: AbortSignal }) => Promise<unknown>;
}

export interface SavedCheckpointEntry {
  sessionId: string;
  checkpointBase64: string;
  timestamp: number;
  model?: string;
}
