import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerLibfxProvider } from "./provider.js";
import { registerCommands } from "./commands.js";
import {
  closeActiveAgent,
  getBackendStatus,
  isNativeKernelEnabled,
  runFxTurn,
} from "./kernel.js";

/**
 * Extension entrypoint for the pi-libfx package.
 */
export default async function (pi: ExtensionAPI): Promise<void> {
  // 1. Register the libfx provider and dynamic model refresh
  registerLibfxProvider(pi);

  // 2. Register slash commands (/libfx status, /libfx toggle, etc.)
  registerCommands(pi);

  // 3. Setup footer status and restore checkpoints on session start
  pi.on("session_start", async (_event, ctx) => {
    const status = await getBackendStatus();
    if (status.nativeAddonAvailable) {
      ctx.ui.setStatus("libfx", "⚡ libfx (native)");
    } else if (status.backend === "wasm-jspi") {
      ctx.ui.setStatus("libfx", "⚡ libfx (wasm)");
    }
  });

  // 4. Intercept user input when native kernel mode is enabled
  pi.on("input", async (event, ctx) => {
    // If native kernel mode is not enabled, let Pi's standard agent loop run
    if (!isNativeKernelEnabled()) {
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

    // Run the prompt through the native Zig libfx kernel
    void runFxTurn(event.text, ctx, pi);

    // Tell Pi the input is handled so it doesn't run the JS agent loop
    return { action: "handled" };
  });

  // 5. Cleanup native resources when session shuts down
  pi.on("session_shutdown", async () => {
    await closeActiveAgent();
  });
}
