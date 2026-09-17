export type LibfxArchitecture = "acp" | "plugin";

export interface LibfxConfig {
  /** Gateway API key (defaults to AI_GATEWAY_API_KEY environment variable) */
  apiKey?: string;
  /** Custom Gateway chat URL override */
  gatewayChatUrl?: string;
  /** Active backend execution mode: auto (prefer native), native, or wasm */
  backend: "auto" | "native" | "wasm";
  /** Architecture mode: acp (native Zig ACP agent loop) or plugin (standard Pi agent loop) */
  arch: LibfxArchitecture;
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

export interface ToolCardData {
  toolName: string;
  toolCallId: string;
  args: any;
  result?: any;
  isError?: boolean;
  isComplete: boolean;
  component?: any;
}

export interface AssistantStreamData {
  content: Array<{ type: "thinking"; thinking: string } | { type: "text"; text: string }>;
  isStreaming: boolean;
  component?: any;
}

export interface ToolExecutionListener {
  onStart?: (toolCallId: string, toolName: string, input: any) => void;
  onUpdate?: (toolCallId: string, update: any) => void;
  onEnd?: (toolCallId: string, result: any, isError: boolean) => void;
}

