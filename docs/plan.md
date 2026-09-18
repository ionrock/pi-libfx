# pi-libfx Improvement Plan

Baseline: commit `c03b500` (clean checkout, no tracked tests, no CI).

This plan turns the codebase review into ordered, verifiable work. It covers three axes:
simplification/correctness, documentation, and test coverage. Each phase lists the problem,
the change, acceptance criteria, and how to verify. Phases are ordered so that every step
leaves the extension working.

Line references point at `c03b500`. They will drift as work lands; treat them as a starting
point, not a contract.

---

## Guiding principles

- Fix the state model before adding features. Several documented promises (config precedence,
  transcript persistence, cancellation, tool parity) are not reliably delivered today.
- Prefer one owner per concern: configuration, ACP turn lifecycle, and presentation currently
  share mutable module-level state.
- Write the regression test first for every confirmed bug, then fix it.
- Document only verified behavior. Remove or qualify claims that cannot be demonstrated.
- Do not introduce a seam until two adapters actually exist across it.

---

## Confirmed defects (drive Phase 1 and 2)

These were reproduced deterministically against `c03b500` without live model calls.

| # | Defect | Location | Evidence |
|---|--------|----------|----------|
| D1 | Registered CLI flag default `"acp"` is returned by `pi.getFlag()` and treated as an explicit override, so `LIBFX_ARCH` and `libfx.json` never win. | `src/index.ts:33-36`, `src/kernel.ts:46-57` | `resolveInitialArchitecture({getFlag:()=>"acp"})` returns `acp` with `LIBFX_ARCH=plugin` set. |
| D2 | Assistant entry is appended to the session while empty; content is mutated in memory afterwards but never re-persisted. Tool cards follow the same pattern. | `src/kernel.ts:276-284`, `:346-377` | Serialized `libfx:assistant` entry has `content: []` after a completed turn. |
| D3 | `turn.result` is never awaited; usage and stop reason are discarded. | `src/kernel.ts:393-431` | Result getter invoked zero times in a full turn. |
| D4 | `AbortController` is created but nothing aborts it; `agent.prompt()` runs outside the `try/finally`. | `src/kernel.ts:269-270`, `:256-267` | Code inspection; no caller of `controller.abort()`. |
| D5 | Architecture is resolved at extension load (before CLI values are final) and again only in UI sessions. Headless modes never re-resolve. | `src/index.ts:39-40`, `:166-168` | Code inspection. |
| D6 | Live TUI components are stored on persisted entry data (`data.component = comp`). | `src/index.ts:85`, `:130` | Code inspection; risk of serializing component internals. |
| D7 | `theme.getMarkdownTheme()` does not exist on `Theme`; Markdown receives `{}` as its theme. | `src/index.ts:102`, `:160` | `Theme` type has no such method; `getMarkdownTheme` is a module export. |
| D8 | Unused code: `LibfxConfig`, `setNativeKernelEnabled`, `isNativeKernelEnabled` import, `pi` param in `getOrCreateAgent`, `OAuthLoginCallbacks` import, `signal` param in `refreshModels`. | various | `tsc --noEmit --noUnusedLocals --noUnusedParameters` exits 1 with 4 errors. |

---

## Phase 0 — Test harness bootstrap

Goal: make it possible to write deterministic tests before touching behavior.

### Changes
- Add `vitest` (or `node:test` if avoiding deps) as a dev dependency.
- Add `test`, `test:watch`, `typecheck`, and `check` scripts to `package.json`.
  `check` runs typecheck with `--noUnusedLocals --noUnusedParameters` plus tests.
- Create `tests/` with:
  - `fixtures/fake-agent.ts`: scripted `FxAgent` that yields a configurable event sequence and
    records `prompt`, `checkpoint`, `close`, and `result` reads.
  - `fixtures/fake-pi.ts`: minimal `ExtensionAPI` recorder (`appendEntry`, `sendMessage`,
    `registerFlag`, `getFlag`, `on`) and `ExtensionContext` builder for `tui`, `print`, `json`, `rpc`.
  - `fixtures/fake-fs.ts`: temp-dir helpers for `.pi/libfx.json` and `~/.pi/agent` layouts.
- Add a GitHub Actions workflow that runs `npm ci`, `npm run check` on Node 22 and 24.
  Note: `libfx` is a `file:../fx/sdk` dependency today (see Phase 5); CI must either vendor a
  stub or check out `fx` alongside. Start with a module mock for `libfx` in tests.

### Acceptance
- `npm run check` exits 0 on a fresh clone with the `libfx` mock.
- No test calls a live model.

---

## Phase 1 — Configuration module (`src/config.ts`)

Goal: one resolver with explicit precedence, one persistence path, visible errors. Fixes D1, D5.

### Changes
1. Extract `resolveInitialArchitecture` and `saveLibfxArchitecture` into `src/config.ts`.
2. Register `--libfx-arch` **without** a default so absence is distinguishable from `"acp"`.
3. Resolver returns `{ arch, source }` where `source ∈ "cli" | "env" | "project" | "global" | "default"`.
4. Precedence: CLI → `LIBFX_ARCH` → project `.pi/libfx.json` → global `<agentDir>/libfx.json` → `acp`.
   Drop the `LIBFX_MODE` and `"provider"` aliases unless a user depends on them.
5. Invalid explicit values (`--libfx-arch foo`, `LIBFX_ARCH=foo`, malformed JSON) raise a
   visible warning and fall through; they do not silently pick a default.
6. Use `getAgentDir()` from Pi for the global path (consistent with `auth.ts`), not `homedir()`.
7. `save` takes an explicit `scope: "project" | "global"`, merges into existing JSON rather than
   replacing it, and returns `{ ok, path } | { ok: false, error }`. Callers surface failures.
8. Resolve once in `session_start` for **all** modes (remove the `hasUI` early return) and expose
   the result via a getter; stop resolving at extension-load time.

### Tests
- Absent flag + `LIBFX_ARCH=plugin` → `plugin`, source `env`.
- Explicit `--libfx-arch acp` + env `plugin` → `acp`, source `cli`.
- Project file beats global file; missing project dir falls to global.
- Invalid values warn and fall through.
- Save merges existing keys; save failure is reported.
- Identical resolution in `tui`, `print`, `json`, `rpc` contexts.

### Acceptance
- D1 regression test passes.
- `/libfx status` shows `arch` and `source`.

---

## Phase 2 — Turn lifecycle owner (`src/kernel.ts` → `src/turn.ts`)

Goal: a single object owns startup, cancellation, result settlement, and cleanup. Fixes D3, D4.

### Changes
1. Introduce `runTurn(prompt, deps)` where `deps` injects the agent factory, clock, and a
   `TurnPresenter` (Phase 3). No direct `ctx.ui` or `process.stdout` calls inside.
2. Move `agent.prompt()` inside the `try`; any failure path reaches `finally`.
3. Wire cancellation: listen to `ctx.signal` (Pi's abort signal) and call `turn.cancel()`;
   treat `AbortError` as "cancelled", not "error".
4. Await `turn.result` exactly once; pass `usage` and `stopReason` to the presenter and include
   them in the finalized transcript record.
5. Reject overlapping turns with a clear error; refuse architecture switches while a turn is active.
6. Checkpoint only after a successful result; on failure, skip checkpoint and say so.
7. Checkpoint restore reads the **active branch** (`sessionManager.getBranch()`), not all
   entries, and validates `sessionId`/`model` before restoring.
8. Remove the `pi` parameter from `getOrCreateAgent`; pass the model id explicitly.

### Tests (scripted fake agent)
- Init failure → presenter receives error, cleanup runs, no checkpoint.
- Synchronous `prompt()` throw → same.
- Iterator throws mid-stream → partial content finalized with error state.
- `result` rejects → error surfaced, no checkpoint.
- Abort signal → `cancel()` called, "cancelled" state, no checkpoint.
- Happy path → result read once, checkpoint appended once, usage recorded.
- Second `runTurn` while active → rejected.

### Acceptance
- D3/D4 regression tests pass.
- `/libfx status` during a turn reports "turn active".

---

## Phase 3 — Presentation module (`src/presentation.ts`)

Goal: separate live rendering from durable transcript records. Fixes D2, D6, D7.

### Changes
1. Define versioned plain records:
   - `libfx:user` `{ v: 1, text }`
   - `libfx:assistant` `{ v: 1, content, usage?, stopReason?, state: "complete" | "error" | "cancelled" }`
   - `libfx:tool` `{ v: 1, toolName, toolCallId, args, result?, isError, state }`
   - `libfx:checkpoint` `{ v: 1, sessionId, model, checkpointBase64, timestamp }`
   No component references, no `isStreaming` flags in persisted data.
2. `TurnPresenter` interface with two adapters:
   - `TuiPresenter`: keeps live `AssistantMessageComponent`/`ToolExecutionComponent` instances in
     a private map keyed by turn/tool id; appends the **finalized** record via `pi.appendEntry`
     when the turn (or tool) completes. Live components are rendered through Pi's widget/entry
     mechanism, not stored on entry data.
   - `PrintPresenter`: writes deltas and tool headers to stdout as today; honors `json` mode by
     emitting structured events rather than ANSI text.
   Only these two adapters exist, so this is a real seam.
3. Entry renderers become pure: they render from the persisted record only, using
   `getMarkdownTheme()` from `@earendil-works/pi-coding-agent`, honor `options.expanded`, and use
   the session `cwd` (`ctx.cwd`) for tool definitions rather than `process.cwd()`.
4. Partial tool output calls `updateResult(update, true)`.
5. Replace the `{ requestRender() {} }` mock with the real `ctx.ui` render request path
   (or a small adapter that schedules `requestRender` on the TUI).
6. Remove the throttle-via-`setStatus` hack; request renders directly through the presenter.
7. Keep a legacy renderer for pre-v1 `libfx:assistant` message entries only if existing sessions
   need it; otherwise delete `registerMessageRenderer("libfx:assistant")`.

### Tests
- Serialize/deserialize each record type; assert no `component` key and round-trip equality.
- Fresh ACP-only session: after one turn, session file contains user, assistant, checkpoint.
- Renderers with real Pi theme produce non-empty output for Markdown, thinking, partial tool
  output, error state, expanded/collapsed.
- `json` mode emits one JSON line per event; `print` mode emits text.

### Acceptance
- D2/D6/D7 regression tests pass.
- Resuming an ACP session re-renders prior turns from persisted records alone.

---

## Phase 4 — Tool execution policy (`src/tools.ts`)

Goal: make what runs, and under whose rules, explicit.

### Changes
1. Build host tools from `pi.getActiveTools()` / `pi.getAllTools()` intersected with the set
   this extension can adapt, instead of hardcoding four.
2. Document (in code and docs) that ACP tool calls bypass Pi's `tool_call`/`tool_result`
   extension hooks. Either:
   - (a) route through Pi's session tool wrapper if a supported API exists, or
   - (b) restrict ACP mode to the built-in four and state the limitation.
   Decide (b) first; revisit (a) when Pi exposes a stable hook.
3. Replace the module-level `activeToolListener` with a listener passed per turn from the
   lifecycle owner.
4. Preserve result semantics: `isError`, partial updates, and abort all map to the same record
   shape the presenter expects.

### Tests
- Disabled tool in Pi → not offered to the agent.
- Tool throws → `isError: true` record; agent receives error string; presenter notified.
- Abort before execute → no execution, aborted record.
- Presenter throwing does not change the tool result returned to the agent.

---

## Phase 5 — Architecture switching and provider selection

Goal: switching changes execution ownership honestly.

### Changes
1. `/libfx arch plugin` explains that it does **not** select the libfx provider; offer to run
   `setModel` to a `libfx/*` model, or document `/model libfx/...` as the next step.
2. Warn on switch that ACP history and Pi history are separate; recommend a new session for
   comparisons. Block switching while a turn is active (Phase 2).
3. Collapse `arch` and `toggle` command branches into one `switchArchitecture(target, scope)`
   operation; both commands call it. Surface save errors.
4. Status output shows: architecture + source, backend, provider currently selected in Pi,
   key configured, turn state.
5. Delete `LibfxConfig`, `setNativeKernelEnabled`, `isNativeKernelEnabled` (or keep one
   getter), and other unused declarations (D8). Enable `noUnusedLocals`/`noUnusedParameters`
   in `tsconfig.json`.

### Tests
- Plugin mode: `input` handler returns `continue`; `runTurn` never invoked.
- ACP mode: eligible plain text handled; slash commands and extension-sourced input continue.
- Switch during active turn → rejected with message.

---

## Phase 6 — Dependency and packaging hygiene

Goal: a fresh clone can build.

### Changes
1. `libfx` is `file:../fx/sdk`. Options, in preference order:
   - publish/consume a versioned `libfx` package;
   - vendor the built SDK artifacts under `vendor/libfx` with a documented refresh script;
   - keep the sibling checkout requirement but fail fast with a clear message and document it.
   Pick one and remove the ambiguity from `package.json`.
2. Pin peer/dev versions of `@earendil-works/*` to a tested range instead of `*`.
3. Add `engines.node`.
4. Verify `npm pack --dry-run` includes exactly `dist`, `themes`, `skills`, `README.md`, `LICENSE`.

---

## Phase 7 — Documentation

Goal: docs describe verified behavior and give a reproducible path from clone to comparison.

### Structure
- `README.md`
  - What it is (one paragraph, no latency claims without a linked benchmark).
  - Requirements: Node, Pi version range, `AI_GATEWAY_API_KEY`.
  - Install (dev path first; npm path only once Phase 6 is done).
  - Quickstart: login, select model, `/libfx status`.
  - Execution modes: ACP vs plugin, what each owns, how to switch, precedence table.
  - Supported-behavior matrix (see below).
  - Limitations.
- `docs/architecture.md`
  - Ownership diagram: config → lifecycle → presenter → tools.
  - Event flow for one ACP turn.
  - Transcript record schema (v1) and checkpoint contract.
  - Why ACP and plugin histories are separate.
- `CONTRIBUTING.md`
  - Clone, sibling `fx` checkout or vendor refresh, `npm ci`, `npm run check`.
  - Manual comparison checklist (below).
  - Release checklist.
- `skills/libfx/SKILL.md`: trim to commands + links; single source of truth is README.

### Supported-behavior matrix (fill from tests, not intent)

| Capability | ACP | Plugin |
|---|---|---|
| Interactive streaming text |  |  |
| Thinking blocks |  |  |
| Tool cards (bash/read/edit/write) |  |  |
| Other Pi tools / extension tools |  |  |
| `tool_call` / `tool_result` hooks |  |  |
| Print mode |  |  |
| JSON mode |  |  |
| RPC mode |  |  |
| Cancellation (Esc / Ctrl-C) |  |  |
| Queued / steer input |  |  |
| Images in prompts |  |  |
| Skills / system prompt |  |  |
| Resume session |  |  |
| Branch / fork |  |  |
| Compaction |  |  |
| Usage accounting in footer |  |  |
| Switch mode mid-session |  |  |

### Claims to remove or qualify now
- "Sub-millisecond prompt-to-first-token latency" (README:9) — remove until benchmarked.
- "Headless safety … under host authority" (README:11) — qualify per Phase 4 decision.
- "Instant multi-turn save and restore" (README:12) — qualify until Phase 3 lands.
- `pi -e npm:pi-libfx` (README:28) — `-e` takes a path; correct or remove.
- Status output sample (README:57-63) — regenerate after Phase 5.

---

## Phase 8 — Manual comparison protocol

Once Phases 1–5 land, use this to actually compare ACP vs plugin.

1. Start two fresh sessions in the same repo: `pi --libfx-arch acp` and `pi --libfx-arch plugin`
   with `/model libfx/<same model>` in both.
2. Run the same script of prompts: plain question, bash tool, read tool, edit tool, a
   cancelled long response, a multi-turn follow-up.
3. Record for each: first-token latency (stopwatch or `transport.response` event), total time,
   transcript fidelity, tool card fidelity, cancellation behavior, footer usage numbers.
4. Quit and `pi --continue` each session; confirm history renders.
5. File findings in `docs/comparison-<date>.md`.

---

## Verification commands (target state)

```bash
npm ci
npm run typecheck        # tsc --noEmit --noUnusedLocals --noUnusedParameters
npm test                 # deterministic unit + contract tests, no network
npm run check            # typecheck + test
npm pack --dry-run       # packaging contents
```

Each phase's PR must include: failing test → fix → passing test, `npm run check` exit 0, and
doc updates for any user-visible behavior change.

---

## Out of scope (for now)

- Implementing a native `streamSimple` provider transport for plugin mode.
- Migrating conversation context between ACP and plugin histories.
- Windows/PowerShell tool support in ACP mode.
- Publishing to npm before Phase 6 resolves the `libfx` dependency.
