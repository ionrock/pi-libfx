# pi-libfx

[![pi-package](https://img.shields.io/badge/pi--package-discoverable-blue)](https://pi.dev/packages)
[![License](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)

Accelerate [Pi](https://pi.dev) with the high-performance native Zig agent kernel from [fx](https://github.com/vercel-labs/fx).

`pi-libfx` embeds the `libfx` agent engine directly into your Pi sessions, giving you:
- **Sub-millisecond prompt-to-first-token latency** via native Zig Node-API addons.
- **Vercel AI Gateway integration** with dynamic model discovery (`/model libfx/...`).
- **Headless safety** with Pi tools (`read`, `write`, `edit`, `bash`) executed under host authority.
- **Opaque binary checkpoints** for instant multi-turn conversation save and restore.
- **Custom Geist-inspired dark theme** (`libfx-dark`).

---

## Installation

Install directly into Pi via npm:

```bash
pi install npm:pi-libfx
```

Or test it in a single session without installing:

```bash
pi -e npm:pi-libfx
```

---

## Getting Started

1. **Authenticate with Vercel AI Gateway:**
   Set the environment variable:
   ```bash
   export AI_GATEWAY_API_KEY="your-api-key"
   ```
   Or authenticate interactively inside Pi:
   ```text
   /login libfx
   ```

2. **Select a Gateway Model:**
   ```text
   /model libfx/google/gemini-2.5-flash-lite
   /model libfx/anthropic/claude-3-7-sonnet
   /model libfx/openai/gpt-4o
   ```

3. **Check Acceleration Status:**
   ```text
   /libfx status
   ```
   Output:
   ```text
   ⚡ libfx Acceleration Status:
     • Active Backend: native (Native Zig Addon)
     • Platform/Arch: darwin-arm64
     • Native Kernel Mode: ENABLED (direct Zig ACP loop)
     • Gateway API Key: CONFIGURED
   ```

---

## Slash Commands

| Command | Description |
| :--- | :--- |
| `/libfx status` | Shows active backend (Native Zig vs Wasm), architecture, and diagnostics |
| `/libfx toggle` | Toggles between native Zig ACP execution and Pi's standard JS agent loop |
| `/libfx help` | Displays available libfx commands |
| `/login libfx` | Prompts for your Vercel AI Gateway key and saves it to `~/.pi/agent/auth.json` |

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                      Pi Terminal                       │
│     (Interactive TUI, CustomEditor, Theme, Diff View)  │
└───────────────────────────┬────────────────────────────┘
                            │
               ┌────────────▼────────────┐
               │    pi-libfx Extension   │
               └────────────┬────────────┘
                            │ JSON-RPC 2.0 (ACP)
               ┌────────────▼────────────┐
               │       libfx (N-API)     │
               └────────────┬────────────┘
                            │ Native Thread
               ┌────────────▼────────────┐
               │     Zig 0.16 Kernel     │
               │   (Memory / Streaming)  │
               └─────────────────────────┘
```

`pi-libfx` hooks into Pi's `ExtensionAPI` to provide seamless dual-mode execution:
1. **Provider Mode:** Registers `libfx` with Pi's model registry so any Gateway model can be used within standard Pi sessions.
2. **Native Kernel Mode:** Intercepts plain prompts and executes them through the compiled Zig agent kernel for minimal latency, backpressured token streams, and instant checkpoints.

---

## License

Apache-2.0
