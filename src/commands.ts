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

        if (ctx.hasUI) {
          ctx.ui.notify(lines.join("\n"), "info");
        } else {
          console.log(lines.join("\n"));
        }
        return;
      }

      if (sub === "toggle" || sub === "mode") {
        const next = !isNativeKernelEnabled();
        setNativeKernelEnabled(next);
        if (ctx.hasUI) {
          ctx.ui.setStatus(
            "libfx",
            next ? "⚡ libfx (native)" : undefined
          );
          ctx.ui.notify(
            `libfx Native Kernel mode is now ${next ? "ENABLED" : "DISABLED"}.`,
            "info"
          );
        } else {
          console.log(`libfx Native Kernel mode is now ${next ? "ENABLED" : "DISABLED"}.`);
        }
        return;
      }

      if (sub === "help") {
        const helpText =
          "libfx Commands:\n" +
          "  /libfx status    - Show backend status and diagnostics\n" +
          "  /libfx toggle    - Toggle between native Zig kernel and Pi agent loop\n" +
          "  /login libfx     - Set Vercel AI Gateway API key";
        if (ctx.hasUI) {
          ctx.ui.notify(helpText, "info");
        } else {
          console.log(helpText);
        }
        return;
      }

      const warn = `Unknown libfx command '${sub}'. Use '/libfx help'.`;
      if (ctx.hasUI) {
        ctx.ui.notify(warn, "warning");
      } else {
        console.warn(warn);
      }
    },
  });
}
