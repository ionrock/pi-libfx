declare module "libfx" {
  export interface FxAgentOptions {
    apiKey: string;
    model?: string;
    gatewayChatUrl?: string;
    backend?: "auto" | "native" | "wasm";
    instructions?: string;
    tools?: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
      execute?: (input: unknown, context: { signal: AbortSignal }) => Promise<unknown>;
    }>;
    checkpoint?: Uint8Array;
    onEvent?: (event: { type: string; timestamp: number; [key: string]: unknown }) => void;
    onPermission?: (params: unknown) => Promise<string | null>;
    fetch?: typeof globalThis.fetch;
    nativeAddon?: string;
    wasm?: string;
  }

  export interface FxTurnEvent {
    type: "text_delta" | "reasoning_delta" | "tool_start" | "tool_end";
    delta?: string;
    id?: string;
    name?: string;
    content?: string;
    isError?: boolean;
  }

  export interface FxTurnResult {
    stopReason: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      reasoningTokens?: number;
    };
  }

  export interface FxTurn extends AsyncIterable<FxTurnEvent> {
    result: Promise<FxTurnResult>;
    cancel(): void;
  }

  export interface FxAgent {
    prompt(input: string, options?: { signal?: AbortSignal }): FxTurn;
    checkpoint(): Promise<Uint8Array>;
    close(): Promise<void>;
  }

  export function createFxAgent(options: FxAgentOptions): Promise<FxAgent>;

  export function listModels(options: {
    apiKey: string;
    fetch?: typeof globalThis.fetch;
  }): Promise<string[]>;

  export interface BackendInfo {
    surface: "agent" | "terminal";
    backend: "native" | "wasm-jspi" | "unavailable";
    attempts: Array<{
      backend: string;
      available: boolean;
      reason?: { code?: string; message?: string };
    }>;
  }

  export function getBackendInfo(options?: {
    surface?: "agent" | "terminal";
    backend?: "auto" | "native" | "wasm";
    nativeAddon?: string;
    wasm?: string;
  }): Promise<BackendInfo>;
}
