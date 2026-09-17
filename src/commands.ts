import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  getBackendStatus,
  getLibfxArchitecture,
  saveLibfxArchitecture,
} from "./kernel.js";
import { resolveApiKey } from "./auth.js";
import type { LibfxArchitecture } from "./types.js";

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("libfx", {
    description: "Manage libfx native acceleration architecture and settings",
    handler: async (args, ctx) => {
      const parts = (args || "").trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase() || "";
      const param = parts[1]?.toLowerCase() || "";

      if (sub === "status" || sub === "") {
        const status = await getBackendStatus();
        const hasKey = !!resolveApiKey();
        const arch = getLibfxArchitecture();

        const lines = [
          "⚡ libfx Architecture & Status:",
          `  • Architecture: ${arch === "acp" ? "ACP (Native Zig ACP agent loop)" : "PLUGIN (Standard Pi provider loop)"}`,
          `  • Active Backend: ${status.backend} ${status.nativeAddonAvailable ? "(Native Zig Addon)" : "(WebAssembly + JSPI)"}`,
          `  • Platform/Arch: ${status.platform}-${status.arch}`,
          `  • Gateway API Key: ${hasKey ? "CONFIGURED" : "NOT SET (run /login libfx)"}`,
          "",
          "Commands to switch architecture:",
          "  /libfx arch acp     - Use native Zig ACP agent kernel (fast native turns)",
          "  /libfx arch plugin  - Use standard Pi agent loop with libfx provider",
          "  /libfx toggle       - Quick toggle between ACP and Plugin architectures",
        ];

        if (status.attempts && status.attempts.length > 0) {
          lines.push("", "  • Backend Probe Details:");
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

      if (sub === "arch" || sub === "mode") {
        let targetArch: LibfxArchitecture | undefined;

        if (param === "acp") {
          targetArch = "acp";
        } else if (param === "plugin" || param === "provider") {
          targetArch = "plugin";
        } else if (!param && ctx.hasUI) {
          // Interactive multiple choice selector
          const current = getLibfxArchitecture();
          const choice = await ctx.ui.select(
            "Select libfx Architecture",
            [
              `acp - Native Zig ACP agent loop ${current === "acp" ? "(currently active)" : ""}`,
              `plugin - Standard Pi agent loop with libfx provider ${current === "plugin" ? "(currently active)" : ""}`,
            ]
          );

          if (choice) {
            targetArch = choice.startsWith("acp") ? "acp" : "plugin";
          } else {
            return;
          }
        } else if (!param) {
          const current = getLibfxArchitecture();
          console.log(`Current architecture: ${current}. Use '/libfx arch acp' or '/libfx arch plugin'.`);
          return;
        } else {
          const msg = `Unknown architecture '${param}'. Choose 'acp' or 'plugin'.`;
          if (ctx.hasUI) ctx.ui.notify(msg, "warning");
          else console.warn(msg);
          return;
        }

        if (targetArch) {
          saveLibfxArchitecture(targetArch, ctx.cwd);
          const status = await getBackendStatus();

          if (ctx.hasUI) {
            if (targetArch === "acp") {
              ctx.ui.setStatus(
                "libfx",
                status.nativeAddonAvailable ? "⚡ libfx (acp-native)" : "⚡ libfx (acp-wasm)"
              );
              ctx.ui.notify("Switched architecture to ACP (Native Zig ACP agent loop).", "info");
            } else {
              ctx.ui.setStatus("libfx", "⚡ libfx (plugin)");
              ctx.ui.notify("Switched architecture to PLUGIN (Standard Pi agent loop with libfx provider).", "info");
            }
          } else {
            console.log(`Switched architecture to ${targetArch.toUpperCase()}.`);
          }
        }
        return;
      }

      if (sub === "toggle") {
        const current = getLibfxArchitecture();
        const next: LibfxArchitecture = current === "acp" ? "plugin" : "acp";
        saveLibfxArchitecture(next, ctx.cwd);
        const status = await getBackendStatus();

        if (ctx.hasUI) {
          if (next === "acp") {
            ctx.ui.setStatus(
              "libfx",
              status.nativeAddonAvailable ? "⚡ libfx (acp-native)" : "⚡ libfx (acp-wasm)"
            );
            ctx.ui.notify("Toggled architecture to ACP (Native Zig ACP agent loop).", "info");
          } else {
            ctx.ui.setStatus("libfx", "⚡ libfx (plugin)");
            ctx.ui.notify("Toggled architecture to PLUGIN (Standard Pi agent loop).", "info");
          }
        } else {
          console.log(`Toggled architecture to ${next.toUpperCase()}.`);
        }
        return;
      }

      if (sub === "help") {
        const helpText =
          "libfx Commands:\n" +
          "  /libfx status          - Show backend status and current architecture\n" +
          "  /libfx arch [acp|plugin] - Switch architecture mode (or open selector)\n" +
          "  /libfx toggle          - Toggle between ACP and Plugin architectures\n" +
          "  /login libfx           - Set Vercel AI Gateway API key";
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
