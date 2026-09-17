import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getBackendStatus, isNativeKernelEnabled, setNativeKernelEnabled } from "./kernel.js";
import { resolveApiKey } from "./auth.js";

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("libfx", {
    description: "Manage the libfx native Zig agent acceleration engine",
    handler: async (args, ctx) => {
      const sub = (args || "").trim().toLowerCase();

      if (sub === "status" || sub === "") {
        const status = await getBackendStatus();
        const hasKey = !!resolveApiKey();
        const nativeOn = isNativeKernelEnabled();

        const lines = [
          "⚡ libfx Acceleration Status:",
          `  • Active Backend: ${status.backend} ${status.nativeAddonAvailable ? "(Native Zig Addon)" : "(WebAssembly + JSPI)"}`,
          `  • Platform/Arch: ${status.platform}-${status.arch}`,
          `  • Native Kernel Mode: ${nativeOn ? "ENABLED (direct Zig ACP loop)" : "DISABLED (standard Pi loop)"}`,
          `  • Gateway API Key: ${hasKey ? "CONFIGURED" : "NOT SET (run /login libfx)"}`,
        ];

        if (status.attempts && status.attempts.length > 0) {
          lines.push("  • Backend Probe Details:");
          for (const attempt of status.attempts) {
            lines.push(
              `    - ${attempt.backend}: ${attempt.available ? "OK" : `Unavailable (${attempt.reason?.code || attempt.reason?.message || "unknown"})`}`
            );
          }
        }

        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (sub === "toggle" || sub === "mode") {
        const next = !isNativeKernelEnabled();
        setNativeKernelEnabled(next);
        ctx.ui.setStatus(
          "libfx",
          next ? "⚡ libfx (native)" : undefined
        );
        ctx.ui.notify(
          `libfx Native Kernel mode is now ${next ? "ENABLED" : "DISABLED"}.`,
          "info"
        );
        return;
      }

      if (sub === "help") {
        ctx.ui.notify(
          "libfx Commands:\n" +
            "  /libfx status    - Show backend status and diagnostics\n" +
            "  /libfx toggle    - Toggle between native Zig kernel and Pi agent loop\n" +
            "  /login libfx     - Set Vercel AI Gateway API key",
          "info"
        );
        return;
      }

      ctx.ui.notify(`Unknown libfx command '${sub}'. Use '/libfx help'.`, "warning");
    },
  });
}
