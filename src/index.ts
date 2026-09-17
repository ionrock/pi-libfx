import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  AssistantMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Markdown, Text } from "@earendil-works/pi-tui";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { registerLibfxProvider } from "./provider.js";
import { registerCommands } from "./commands.js";
import {
  closeActiveAgent,
  getBackendStatus,
  getLibfxArchitecture,
  isNativeKernelEnabled,
  resolveInitialArchitecture,
  runFxTurn,
} from "./kernel.js";
import { getToolDefinition } from "./tools.js";
import type { AssistantStreamData, ToolCardData } from "./types.js";

/**
 * Extension entrypoint for the pi-libfx package.
 */
export default async function (pi: ExtensionAPI): Promise<void> {
  // 1. Register the libfx provider and dynamic model refresh
  registerLibfxProvider(pi);

  // 2. Register slash commands (/libfx status, /libfx arch, /libfx toggle, etc.)
  registerCommands(pi);

  // 2b. Register architecture flag: --libfx-arch <acp|plugin>
  pi.registerFlag("libfx-arch", {
    description: "libfx architecture mode: 'acp' (native Zig ACP agent loop) or 'plugin' (standard Pi provider loop)",
    type: "string",
    default: "acp",
  });

  // Resolve initial architecture from CLI flag, env, config, or default
  resolveInitialArchitecture(pi);

  // 3. Register custom entry renderers for interactive transcript parity

  // 3a. User prompt entry renderer
  pi.registerEntryRenderer<{ text: string }>("libfx:user", (entry, _options, theme) => {
    const text = entry.data?.text ?? "";
    try {
      return new UserMessageComponent(text);
    } catch {
      const box = new Box(1, 1, (t) => theme.bg("userMessageBg", t));
      box.addChild(new Text(theme.fg("userMessageText", theme.bold("User")), 0, 0));
      box.addChild(new Text(text, 0, 0));
      return box;
    }
  });

  // 3b. Assistant streaming & thinking entry renderer
  pi.registerEntryRenderer<AssistantStreamData>("libfx:assistant", (entry, options, theme) => {
    const data = entry.data;
    const msg: AssistantMessage = {
      role: "assistant",
      content: (data?.content ?? []).map((c) => {
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

    try {
      const comp = new AssistantMessageComponent(
        msg,
        false,
        undefined,
        "Thinking...",
        options.expanded ? 1 : 1
      );
      if (data) {
        data.component = comp;
      }
      return comp;
    } catch {
      const container = new Container();
      const thinkingParts = msg.content
        .filter((c): c is { type: "thinking"; thinking: string } => c.type === "thinking")
        .map((c) => c.thinking)
        .join("\n");
      if (thinkingParts) {
        container.addChild(new Text(theme.fg("thinkingText", `Thinking:\n${thinkingParts}`), 1, 0));
      }
      const textParts = msg.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      if (textParts) {
        container.addChild(new Markdown(textParts, 1, 0, (theme as any).getMarkdownTheme?.() ?? {}));
      }
      return container;
    }
  });

  // 3c. Tool execution card entry renderer
  pi.registerEntryRenderer<ToolCardData>("libfx:tool", (entry, _options, theme) => {
    const data = entry.data;
    if (!data) return new Container();
    const cwd = process.cwd();
    const toolDef = getToolDefinition(data.toolName, cwd);

    try {
      const mockUi = { requestRender() {} };
      const comp = new ToolExecutionComponent(
        data.toolName,
        data.toolCallId,
        data.args ?? {},
        {},
        toolDef,
        mockUi as any,
        cwd
      );
      if (data.isComplete && data.result) {
        comp.setArgsComplete();
        comp.updateResult(data.result);
      }
      data.component = comp;
      return comp;
    } catch {
      const box = new Box(1, 1, (t) => theme.bg("toolPendingBg", t));
      box.addChild(new Text(theme.fg("toolTitle", theme.bold(data.toolName)), 0, 0));
      box.addChild(new Text(JSON.stringify(data.args, null, 2), 0, 0));
      if (data.result) {
        box.addChild(new Text(JSON.stringify(data.result, null, 2), 0, 0));
      }
      return box;
    }
  });

  // 3d. Fallback custom message renderer with Markdown & thinking styling
  pi.registerMessageRenderer("libfx:assistant", (message, options, theme) => {
    const text =
      typeof message.content === "string"
        ? message.content
        : (message.content ?? [])
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");
    const details = message.details as any;
    const container = new Container();
    if (details?.reasoning) {
      container.addChild(
        new Text(theme.fg("thinkingText", `Thinking:\n${details.reasoning}`), options.outputPad ?? 1, 0)
      );
    }
    container.addChild(
      new Markdown(text, options.outputPad ?? 1, 0, (theme as any).getMarkdownTheme?.() ?? {})
    );
    return container;
  });

  // 4. Setup footer status on session start
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    const arch = resolveInitialArchitecture(pi, ctx.cwd);
    const status = await getBackendStatus();

    if (arch === "acp") {
      ctx.ui.setStatus(
        "libfx",
        status.nativeAddonAvailable ? "⚡ libfx (acp-native)" : "⚡ libfx (acp-wasm)"
      );
    } else {
      ctx.ui.setStatus("libfx", "⚡ libfx (plugin)");
    }
  });

  // 5. Intercept user input when native ACP kernel architecture is active
  pi.on("input", async (event, ctx) => {
    // If not in ACP mode (i.e. in plugin mode), let Pi's standard agent loop run
    if (getLibfxArchitecture() !== "acp") {
      return { action: "continue" };
    }

    // Skip extension-generated messages to prevent loops
    if (event.source === "extension") {
      return { action: "continue" };
    }

    // Only handle plain user prompts
    if (event.text.startsWith("/")) {
      return { action: "continue" };
    }

    // Immediately display the user's prompt in Pi's transcript
    if (ctx.hasUI) {
      pi.appendEntry("libfx:user", { text: event.text });
    }

    // Run the prompt through the native Zig libfx kernel
    await runFxTurn(event.text, ctx, pi);

    // Tell Pi the input is handled so it doesn't run the JS agent loop
    return { action: "handled" };
  });

  // 6. Cleanup native resources when session shuts down
  pi.on("session_shutdown", async () => {
    await closeActiveAgent();
  });
}
