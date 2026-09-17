---
name: libfx
description: Native Zig agent acceleration engine for Pi powered by fx and the Vercel AI Gateway. Use whenever the user asks about fx, libfx, agent speed, native Zig addons, or gateway models.
---

# libfx Agent Acceleration

`libfx` is the native agent kernel from `fx` compiled directly in Zig 0.16. It powers fast prompt-to-first-token execution, lossless backpressured streaming, and lightweight memory consumption.

## Key Capabilities

1. **Native Zig Agent Loop:**
   - Powered by a headless native Node-API addon (`libfx.<platform>-<arch>.node`) or WebAssembly with JSPI fallback.
   - Bounded ACP (Agent Client Protocol) communication between Zig worker threads and the JavaScript host.

2. **Vercel AI Gateway Integration:**
   - Global low-latency routing to leading models across Anthropic, OpenAI, Google, DeepSeek, and more.
   - Dynamic model discovery with `/model libfx/...`.

3. **Checkpoints & Session Resumption:**
   - Bounded, versioned opaque checkpoints preserve conversation context and usage across turns and restarts.

4. **Configurable Architecture (ACP vs Plugin):**
   - **`acp`**: Direct native Zig ACP agent kernel execution with presentation bridge.
   - **`plugin`**: Standard Pi agent loop with libfx model provider routing.
   - CLI flag: `--libfx-arch <acp|plugin>`
   - Environment variable: `LIBFX_ARCH=acp` or `LIBFX_ARCH=plugin`
   - Persistent config: `.pi/libfx.json` or `~/.pi/agent/libfx.json`

5. **Slash Commands:**
   - `/libfx status`: Check backend status, active architecture, and diagnostics.
   - `/libfx arch [acp|plugin]`: Switch architecture (interactive selector if omitted).
   - `/libfx toggle`: Quick toggle between ACP and Plugin architectures.
   - `/login libfx`: Set or update the Gateway API key.
