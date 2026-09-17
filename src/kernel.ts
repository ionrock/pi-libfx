import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createFxAgent, getBackendInfo } from "libfx";
import { resolveApiKey } from "./auth.js";
import { getHostTools, setToolExecutionListener } from "./tools.js";
import type {
  AssistantStreamData,
  LibfxArchitecture,
  LibfxBackendStatus,
  SavedCheckpointEntry,
  ToolCardData,
} from "./types.js";

interface ActiveSession {
  agent: any;
  model: string;
  lastCheckpoint?: Uint8Array;
}

let activeSession: ActiveSession | null = null;
let activeArchitecture: LibfxArchitecture = "acp";

export function getLibfxArchitecture(): LibfxArchitecture {
  return activeArchitecture;
}

export function setLibfxArchitecture(arch: LibfxArchitecture): void {
  activeArchitecture = arch;
}

export function isNativeKernelEnabled(): boolean {
  return activeArchitecture === "acp";
}

export function setNativeKernelEnabled(enabled: boolean): void {
  activeArchitecture = enabled ? "acp" : "plugin";
}

/**
 * Resolves initial architecture from CLI flag, environment variable, persistent config, or default.
 */
export function resolveInitialArchitecture(pi?: ExtensionAPI, cwd?: string): LibfxArchitecture {
  // 1. CLI flag: --libfx-arch <acp|plugin>
  try {
    const flag = pi?.getFlag?.("libfx-arch");
    if (typeof flag === "string") {
      const norm = flag.trim().toLowerCase();
      if (norm === "acp" || norm === "plugin" || norm === "provider") {
        const arch: LibfxArchitecture = norm === "provider" ? "plugin" : (norm as LibfxArchitecture);
        setLibfxArchitecture(arch);
        return arch;
      }
    }
  } catch {}

  // 2. Environment variable: LIBFX_ARCH or LIBFX_MODE
  const envVal = (process.env.LIBFX_ARCH || process.env.LIBFX_MODE || "").trim().toLowerCase();
  if (envVal === "acp" || envVal === "plugin" || envVal === "provider") {
    const arch: LibfxArchitecture = envVal === "provider" ? "plugin" : (envVal as LibfxArchitecture);
    setLibfxArchitecture(arch);
    return arch;
  }

  // 3. Persistent config in local .pi/libfx.json
  try {
    const localConfig = join(cwd || process.cwd(), ".pi", "libfx.json");
    if (existsSync(localConfig)) {
      const data = JSON.parse(readFileSync(localConfig, "utf8"));
      if (data?.arch === "acp" || data?.arch === "plugin") {
        setLibfxArchitecture(data.arch);
        return data.arch;
      }
    }
  } catch {}

  // 4. Persistent config in global ~/.pi/agent/libfx.json
  try {
    const globalConfig = join(homedir(), ".pi", "agent", "libfx.json");
    if (existsSync(globalConfig)) {
      const data = JSON.parse(readFileSync(globalConfig, "utf8"));
      if (data?.arch === "acp" || data?.arch === "plugin") {
        setLibfxArchitecture(data.arch);
        return data.arch;
      }
    }
  } catch {}

  setLibfxArchitecture("acp");
  return "acp";
}

/**
 * Persists the chosen architecture to the local .pi/libfx.json or global ~/.pi/agent/libfx.json.
 */
export function saveLibfxArchitecture(arch: LibfxArchitecture, cwd?: string): boolean {
  setLibfxArchitecture(arch);
  try {
    const localDir = join(cwd || process.cwd(), ".pi");
    if (existsSync(localDir)) {
      const configPath = join(localDir, "libfx.json");
      writeFileSync(configPath, JSON.stringify({ arch }, null, 2), "utf8");
      return true;
    }

    const globalDir = join(homedir(), ".pi", "agent");
    if (existsSync(globalDir)) {
      const configPath = join(globalDir, "libfx.json");
      writeFileSync(configPath, JSON.stringify({ arch }, null, 2), "utf8");
      return true;
    }
  } catch {}
  return false;
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
  let model = modelId || ctx.model?.id || "google/gemini-2.5-flash-lite";
  if (model.startsWith("libfx/")) {
    model = model.slice("libfx/".length);
  }

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

  // Restore latest checkpoint from session history if not provided
  if (!initialCheckpoint && ctx.sessionManager?.getEntries) {
    try {
      const entries = ctx.sessionManager.getEntries();
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i] as any;
        if (e?.type === "custom" && e?.customType === "libfx:checkpoint" && e?.data?.checkpointBase64) {
          initialCheckpoint = Buffer.from(e.data.checkpointBase64, "base64");
          break;
        }
      }
    } catch {}
  }

  // Get active host tools for the current session working directory
  const hostTools = getHostTools(ctx);

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

function formatToolArgs(toolName: string, args: any): string {
  if (!args) return "";
  if (toolName === "bash" && typeof args.command === "string") {
    return `$ ${args.command}`;
  }
  if ((toolName === "read" || toolName === "edit" || toolName === "write") && typeof args.path === "string") {
    return args.path;
  }
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

function formatToolResult(result: any, _isError: boolean): string {
  if (!result) return "";
  if (Array.isArray(result.content)) {
    return result.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  }
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
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
  if (ctx.hasUI) {
    ctx.ui.setStatus(
      "libfx",
      status.nativeAddonAvailable ? "⚡ libfx (acp-native running)" : "⚡ libfx (acp-wasm running)"
    );
    ctx.ui.setWorkingMessage("Thinking...");
    ctx.ui.setWorkingVisible(true);
  }

  let agent: any;
  try {
    agent = await getOrCreateAgent(ctx, pi);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (ctx.hasUI) {
      ctx.ui.notify(msg, "error");
    } else {
      console.error(msg);
    }
    return;
  }

  const controller = new AbortController();
  const turn = agent.prompt(promptText, { signal: controller.signal });

  // Stream entries & tool cards management
  let activeStream: AssistantStreamData | null = null;
  const activeToolCards = new Map<string, ToolCardData>();

  function getOrCreateStream(): AssistantStreamData {
    if (!activeStream) {
      activeStream = {
        content: [],
        isStreaming: true,
      };
      if (ctx.hasUI) {
        pi.appendEntry("libfx:assistant", activeStream);
      }
    }
    return activeStream;
  }

  function toAssistantMessage(content: AssistantStreamData["content"]): AssistantMessage {
    return {
      role: "assistant",
      content: content.map((c) => {
        if (c.type === "thinking") {
          return { type: "thinking" as const, thinking: c.thinking };
        }
        return { type: "text" as const, text: c.text };
      }),
      api: "openai-completions",
      provider: "libfx",
      model: "libfx",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as any,
      stopReason: "stop",
      timestamp: Date.now(),
    };
  }

  function flushActiveStream(): void {
    if (activeStream) {
      activeStream.isStreaming = false;
      if (activeStream.component) {
        activeStream.component.updateContent(toAssistantMessage(activeStream.content), false);
      }
      activeStream = null;
    }
  }

  // Throttle render requests to prevent UI lag on high token rates (~25fps)
  let lastRender = 0;
  let renderTimer: NodeJS.Timeout | null = null;

  function triggerUiRender(statusLabel = "⚡ libfx (streaming)") {
    if (!ctx.hasUI) return;
    const now = Date.now();
    if (now - lastRender > 40) {
      lastRender = now;
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      ctx.ui.setStatus("libfx", statusLabel);
    } else if (!renderTimer) {
      renderTimer = setTimeout(() => {
        renderTimer = null;
        lastRender = Date.now();
        ctx.ui.setStatus("libfx", statusLabel);
      }, 40);
    }
  }

  // Hook host tool execution into the UI presentation
  setToolExecutionListener({
    onStart(toolCallId, toolName, input) {
      // Finalize any assistant text streamed before this tool started
      flushActiveStream();

      const toolCard: ToolCardData = {
        toolName,
        toolCallId,
        args: input,
        isComplete: false,
      };
      activeToolCards.set(toolCallId, toolCard);

      if (ctx.hasUI) {
        pi.appendEntry("libfx:tool", toolCard);
        ctx.ui.setWorkingMessage(`Running ${toolName}...`);
        ctx.ui.setStatus("libfx", `⚡ libfx (${toolName})`);
      } else if (ctx.mode === "print") {
        process.stdout.write(`\n\x1b[1;36m[tool: ${toolName}]\x1b[0m ${formatToolArgs(toolName, input)}\n`);
      }
    },
    onUpdate(toolCallId, update) {
      const card = activeToolCards.get(toolCallId);
      if (card?.component) {
        card.component.updateResult(update);
        triggerUiRender(`⚡ libfx (${card.toolName})`);
      }
    },
    onEnd(toolCallId, result, isError) {
      const card = activeToolCards.get(toolCallId);
      if (card) {
        card.result = result;
        card.isError = isError;
        card.isComplete = true;
        if (card.component) {
          card.component.setArgsComplete();
          card.component.updateResult(result);
          triggerUiRender("⚡ libfx (running)");
        }
      }
      if (ctx.hasUI) {
        ctx.ui.setWorkingMessage("Thinking...");
        ctx.ui.setStatus("libfx", "⚡ libfx (running)");
      } else if (ctx.mode === "print") {
        const out = formatToolResult(result, isError);
        if (out) {
          process.stdout.write(`\x1b[2m${out}\x1b[0m\n\n`);
        }
      }
    },
  });

  try {
    for await (const event of turn) {
      if (event.type === "reasoning_delta") {
        if (ctx.hasUI) {
          const stream = getOrCreateStream();
          let item = stream.content.find((c) => c.type === "thinking") as
            | { type: "thinking"; thinking: string }
            | undefined;
          if (!item) {
            item = { type: "thinking", thinking: "" };
            const textIndex = stream.content.findIndex((c) => c.type === "text");
            if (textIndex >= 0) {
              stream.content.splice(textIndex, 0, item);
            } else {
              stream.content.push(item);
            }
          }
          item.thinking += event.delta;
          stream.component?.updateContent(toAssistantMessage(stream.content), true);
          triggerUiRender("⚡ libfx (thinking...)");
        }
      } else if (event.type === "text_delta") {
        if (ctx.hasUI) {
          const stream = getOrCreateStream();
          let item = stream.content.find((c) => c.type === "text") as
            | { type: "text"; text: string }
            | undefined;
          if (!item) {
            item = { type: "text", text: "" };
            stream.content.push(item);
          }
          item.text += event.delta;
          stream.component?.updateContent(toAssistantMessage(stream.content), true);
          triggerUiRender("⚡ libfx (streaming)");
        } else if (ctx.mode === "print") {
          process.stdout.write(event.delta);
        }
      }
    }

    if (ctx.mode === "print") {
      process.stdout.write("\n");
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
      if (ctx.hasUI) {
        ctx.ui.notify("Turn cancelled.", "warning");
      }
    } else {
      const msg = `libfx error: ${error instanceof Error ? error.message : String(error)}`;
      if (ctx.hasUI) {
        ctx.ui.notify(msg, "error");
      } else {
        console.error(msg);
      }
    }
  } finally {
    setToolExecutionListener(null);
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    flushActiveStream();

    if (ctx.hasUI) {
      ctx.ui.setWorkingVisible(false);
      ctx.ui.setStatus(
        "libfx",
        status.nativeAddonAvailable ? "⚡ libfx (acp-native)" : "⚡ libfx (acp-wasm)"
      );
    }
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
