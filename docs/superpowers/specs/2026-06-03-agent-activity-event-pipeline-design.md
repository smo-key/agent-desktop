# Agent Activity Event Pipeline — Design

**Date:** 2026-06-03
**Status:** Approved design, ready for implementation planning
**Topic:** Reliable per-agent status, current-action, and activity timeline via an expanded Claude Code hook → Unix-socket → durable-sink pipeline.

## Problem

agent-desktop runs Claude Code as an **interactive PTY** (the real TUI renders in an xterm pane; the user types into it directly). It observes session state from the *side* via several signals of uneven reliability:

- **statusline-wrapper snapshot** (`usage://snapshot`) — fragile: depends on Claude re-rendering its status bar, which is sparse and stops entirely while Claude waits at a prompt.
- **transcript-tail polling** (`activity_for`, every 1.5s) — durable but laggy, and structurally cannot see a *pending* `AskUserQuestion` (it isn't written to the transcript until answered).
- **`question-hook.cjs` sidecar** — captures the one thing the transcript can't: the pending question.
- **PTY-byte activity** (`runtime.ts`) — coarse `working`/`waiting` from a 2500 ms byte window.

The result: status is heuristic, there is no per-tool detail ("currently running `npm test`"), and the load-bearing status source (statusline) is the least reliable one.

**Goal:** retrieve more information, more reliably — a deterministic, event-driven activity feed with a per-tool timeline — while **keeping the interactive Claude TUI** (no headless/stream-json rewrite).

## Key constraint that shapes everything

The research-favored tools (`--output-format stream-json`, `--include-partial-messages`, `--include-hook-events`) **only work with `-p`/`--print` (headless)** and are mutually exclusive with the interactive TUI we render. `stdout` is *either* the TUI *or* the JSON stream — never both. Therefore the structured, reliable signal for an interactive session is **hooks + the transcript**, not stdout. This design commits to that.

## Decisions (locked)

1. **Interaction model:** keep the interactive TUI; enrich the side-channel. (Not headless stream-json.)
2. **Transport:** a **Unix-domain socket** hosted by the Rust/Tauri process. Lowest latency; the app always runs when it spawns Claude, and PTY children die with the app, so a session can never outlive the app — neutralizing the socket's usual "lost if app down" downside.
3. **Detail level:** **full per-tool timeline** — every `PreToolUse`/`PostToolUse`, summarized to `tool + key input`.
4. **Integration approach (A — event-sourced):** hook events become the **primary source of truth** for status and activity; transcript reads become **event-triggered**; the statusline snapshot is **kept but demoted** to a non-critical cost/model source.
5. **Persistence:** a **durable JSONL sink behind the live socket**, keyed by `sessionId`, **pruned** (30-day / ~5 MB-per-session retention).

## Architecture

```
claude (PTY, full TUI)
  └─ fires hook ──> event-hook.cjs ──(JSON line)──> Unix socket
                                                       │
                       Rust events.rs: accept → parse → ring buffer (hot)
                                                       │           └─ append → events/<sessionId>.jsonl (durable)
                                                       │
                              emit overview://event  +  events_for() seed
                                                       │
                  EventStore (svelte): status + currentAction + timeline
                                                       │
            on Stop / PostToolUse → activity_for() transcript read (summary, contextPct)

statusline-wrapper → usage://snapshot → cost, model ONLY (demoted, non-critical)
```

**Principle:** hooks tell you precisely *when* and *what kind*; the transcript supplies *content*. The pending-question is the one case where the hook itself carries content (it isn't in the transcript yet).

## Components

### `event-hook.cjs` (new; replaces `question-hook.cjs`)

A single Node script wired to the full event set: `SessionStart`, `UserPromptSubmit`, `PreToolUse(*)`, `PostToolUse(*)`, `Notification`, `Stop`, `SubagentStop`, `SessionEnd`. It:

- Reads the hook JSON from stdin.
- Builds a normalized event: `paneId` (from `$AGENT_DESKTOP_PANE`), `sessionId`, `hook_event_name`, timestamp, and event-specific fields.
- Produces a cheap **input summary** for tool events: `Bash:<command head>`, `Edit:<basename(file_path)>`, `Write:<basename>`, `Read:<basename>`, `Task:<subagent_type or description>`, MCP → tool name; default → `tool_name`.
- For `PreToolUse[AskUserQuestion]`, carries the structured question payload (header, prompt, multiSelect, options) — folding in the old sidecar's job.
- Connects to `$AGENT_DESKTOP_SOCKET_PATH` with a short connect timeout (~200 ms), writes one JSON line, and **exits 0 swallowing every error** so Claude is never blocked if the app is down or the socket is stale.

### `buildSpawnOverride()` — `src/lib/usage/spawn.ts`

- Inject `AGENT_DESKTOP_SOCKET_PATH` env (alongside the existing `AGENT_DESKTOP_PANE` / `AGENT_DESKTOP_SNAPSHOT_DIR`).
- Rewrite `settings.hooks` to register the single `event-hook.js` across the full event set, with `PreToolUse`/`PostToolUse` matching all tools.
- Keep `statusLine` (demoted) and `remoteControlAtStartup: false`.
- Preserve the existing shell-quoting (`quoteCommand`) for paths under `~/Library/Application Support/…`.

### `src-tauri/src/events.rs` (new)

- On startup: unlink any stale socket, create the Unix listener at a path under the app data dir; expose it via `usage_paths` (add `socket_path`).
- Tokio accept-loop: each connection reads a JSON line → deserialize to `AgentEvent` → stamp receive-time → (a) push to a bounded per-pane **ring buffer** (~500), (b) **append** to the durable sink `events/<sessionId>.jsonl`, (c) **emit** Tauri `overview://event`.
- New command `events_for(paneId | sessionId)` to seed the timeline on mount/resume (reads ring, falls back to the durable file).
- Drop malformed lines; bound buffers; remove the socket file on shutdown.
- **Retention** (run on startup): prune event logs for sessions not touched in 30 days; truncate any single log exceeding ~5 MB from the head. Both tunable.

### `src/lib/overview/events.svelte.ts` (new)

Subscribes to `overview://event`; holds `paneId → Event[]` (ring) plus derived `currentAction` and event-sourced `status`; seeded via `events_for`.

### Status, roster, route wiring

- `runtime.ts` / `view.svelte.ts` / `roster.ts`: status derived from events; PTY bytes demoted to fallback; `AgentRow` gains `currentAction: string | null`; PTY `exit` stays authoritative for crash/exit-code.
- `+page.svelte` / `activity.svelte.ts`: replace the fixed 1.5 s `activity_for` poll with **event-triggered reads** on `Stop`/`PostToolUse`, plus a slow **~5 s safety poll**. `activity_for` (transcript tail) is otherwise unchanged; the `read_pending_questions` sidecar path is retired in favor of the event.

## Status derivation

| Signal | Status |
|---|---|
| `UserPromptSubmit`, recent `PreToolUse`/`PostToolUse` | `working`; `currentAction` = latest `PreToolUse` with no matching `PostToolUse` |
| `Notification` (waiting/permission) or pending `AskUserQuestion` | `waiting` / `blocked` |
| `Stop` / `SubagentStop`, no further activity | `idle` / `done` |
| PTY `exit` (code) | `finished` / `error` *(authoritative)* |
| no events yet | PTY-byte heuristic *(fallback only)* |

## Persistence & durability

- **Durable record:** every event is appended to `events/<sessionId>.jsonl`, keyed by `sessionId` (persisted in the workspace registry, matches the transcript filename). The in-memory ring is a hot cache; this file is the source of truth for history.
- **Rehydration:** `events_for()` seeds from the durable file on startup/resume, so `claude --resume <sessionId>` shows the prior tool timeline rather than an empty panel.
- **What survives a restart:** message content & context% (transcript), session identity (workspace registry), cost/model (snapshot), **and now the per-tool timeline + live-only events** (durable sink). Derived status is recomputed.
- **Retention (pruned):** 30-day session retention; ~5 MB per-session cap. Tunable.
- **Backfill:** sessions predating this feature (no events file) reconstruct a completed-tool timeline by parsing `tool_use`/`tool_result` blocks from the durable transcript on first open.

## Error handling & ordering

- **Hook:** swallow all errors, connect-timeout ~200 ms, always exit 0 → never blocks Claude.
- **Socket:** drop malformed lines; recreate a stale socket on boot; bound buffers against memory growth.
- **Ordering:** events tagged with receive-time. Strict global ordering isn't required — Claude runs tools serially per session; subagents are the only concurrency and are keyed by session. No orphaned reconnects (PTY children die with the app).

## What is retired vs kept

- **Retired:** `question-hook.cjs` (folded into `event-hook.cjs`), the `*.question.json` sidecar + `read_pending_questions`, the fixed 1.5 s poll.
- **Kept:** statusline wrapper (demoted → cost/model only), `activity_for` transcript tail (now event-triggered), PTY exit-code status.

## Testing (TDD)

- `spawn.test.ts`: socket env injected; hook registered for the full event set with correct matchers + quoting.
- `event-hook` unit: stdin → payload mapping; input-summary cases; graceful no-op when socket absent.
- `events.rs`: accept → parse → emit; durable append; malformed drop; ring bound; retention pruning; stale-socket cleanup.
- `events.svelte.ts`: ingestion; `currentAction` derivation; status mapping; seeding from durable file.
- Status mapping + integration: an event sequence drives the expected roster `status`/`currentAction` transitions across a simulated restart (seed from disk).

## Open decision (defer to implementation, do not block)

**UI surface** for the new data: inline "doing X" label on each agent card vs. an expandable per-agent timeline panel. Default: **both** — inline label always, expandable timeline on click. This is the data/observability layer; the UI placement is confirmable during implementation.

## Out of scope

- Headless/stream-json interaction model (explicitly rejected — keeps the TUI).
- Dropping the statusline wrapper / computing cost from a pricing table (Approach C — rejected for maintenance burden).
- Cross-machine / cloud sync of the event log.
