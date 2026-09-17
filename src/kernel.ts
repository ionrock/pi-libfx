import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createFxAgent, getBackendInfo } from "libfx";
import { resolveApiKey } from "./auth.js";
import { adaptPiToolsToLibfx } from "./tools.js";
import type { LibfxBackendStatus, SavedCheckpointEntry } from "./types.js";

interface ActiveSession {
  agent: any;
  model: string;
  lastCheckpoint?: Uint8Array;
}

let activeSession: ActiveSession | null = null;
let nativeKernelEnabled = true;

export function isNativeKernelEnabled(): boolean {
  return nativeKernelEnabled;
}

export function setNativeKernelEnabled(enabled: boolean): void {
  nativeKernelEnabled = enabled;
}

/**
 * Inspects backend availability (native Node-API addon vs Wasm).
 */
export async function getBackendStatus(): Promise<LibfxBackendStatus> {
  try {
    const info = await getBackendInfo({ surface: "agent", backend: "auto" });
    return {
      backend: info.backend,
      platform: process.platform,
      arch: process.arch,
      nativeAddonAvailable: info.backend === "native",
      attempts: info.attempts ?? [],
    };
  } catch (error) {
    return {
      backend: "unavailable",
      platform: process.platform,
      arch: process.arch,
      nativeAddonAvailable: false,
      attempts: [{ backend: "auto", available: false, reason: { message: String(error) } }],
    };
  }
}

/**
 * Obtains or initialises the active libfx agent instance.
 */
export async function getOrCreateAgent(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  modelId?: string,
  initialCheckpoint?: Uint8Array
): Promise<any> {
  const model = modelId || "google/gemini-2.5-flash-lite";

  if (activeSession && activeSession.model === model) {
    return activeSession.agent;
  }

  if (activeSession) {
    try {
      await activeSession.agent.close();
    } catch {}
    activeSession = null;
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error(
      "No Vercel AI Gateway API key found. Set AI_GATEWAY_API_KEY or run `/login libfx`."
    );
  }

  // Get active tools from Pi
  const registeredTools = typeof pi.getAllTools === "function" ? (pi.getAllTools() as any) : [];
  const hostTools = adaptPiToolsToLibfx(registeredTools, ctx);

  const agent = await createFxAgent({
    apiKey,
    model,
    backend: "auto",
    tools: hostTools,
    checkpoint: initialCheckpoint,
  });

  activeSession = {
    agent,
    model,
  };

  return agent;
}

/**
 * Executes a full turn using the native Zig libfx agent.
 */
export async function runFxTurn(
  promptText: string,
  ctx: ExtensionContext,
  pi: ExtensionAPI
): Promise<void> {
  const status = await getBackendStatus();
  ctx.ui.setStatus(
    "libfx",
    status.nativeAddonAvailable ? "⚡ libfx (native)" : "⚡ libfx (wasm)"
  );

  let agent: any;
  try {
    agent = await getOrCreateAgent(ctx, pi);
  } catch (err) {
    ctx.ui.notify(
      err instanceof Error ? err.message : String(err),
      "error"
    );
    return;
  }

  const controller = new AbortController();
  const turn = agent.prompt(promptText, { signal: controller.signal });

  let fullText = "";
  let fullReasoning = "";

  try {
    for await (const event of turn) {
      if (event.type === "text_delta") {
        fullText += event.delta;
      } else if (event.type === "reasoning_delta") {
        fullReasoning += event.delta;
      } else if (event.type === "tool_start") {
        ctx.ui.setStatus("libfx-tool", `Running ${event.name}...`);
      } else if (event.type === "tool_end") {
        ctx.ui.setStatus("libfx-tool", undefined);
      }
    }

    const result = await turn.result;

    // Send the completed assistant message into Pi's transcript
    if (fullText.length > 0) {
      pi.sendMessage({
        customType: "libfx:assistant",
        content: fullText,
        display: true,
        details: {
          reasoning: fullReasoning || undefined,
          usage: result?.usage,
          stopReason: result?.stopReason,
        },
      });
    }

    // Persist checkpoint for multi-turn session durability
    try {
      const checkpointBytes = await agent.checkpoint();
      if (checkpointBytes && checkpointBytes.length > 0) {
        const base64 = Buffer.from(checkpointBytes).toString("base64");
        pi.appendEntry("libfx:checkpoint", {
          sessionId: ctx.sessionManager?.getSessionFile?.() || "default",
          checkpointBase64: base64,
          timestamp: Date.now(),
        } satisfies SavedCheckpointEntry);
      }
    } catch {}
  } catch (error) {
    if (controller.signal.aborted) {
      ctx.ui.notify("Turn cancelled.", "warning");
    } else {
      ctx.ui.notify(
        `libfx error: ${error instanceof Error ? error.message : String(error)}`,
        "error"
      );
    }
  } finally {
    ctx.ui.setStatus("libfx-tool", undefined);
  }
}

/**
 * Closes and frees the active libfx agent runtime.
 */
export async function closeActiveAgent(): Promise<void> {
  if (activeSession) {
    try {
      await activeSession.agent.close();
    } catch {}
    activeSession = null;
  }
}
