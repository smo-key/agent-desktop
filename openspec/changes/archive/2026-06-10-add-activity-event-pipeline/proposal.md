## Why

Session status and activity are inferred from uneven side-channels — a fragile statusline snapshot (stops re-rendering while Claude waits), a laggy 1.5s transcript poll (can't see a pending question), and a coarse PTY-byte heuristic. Status is guesswork and there is no per-tool detail ("running `npm test`"). Claude Code's hook system can emit deterministic lifecycle events for an interactive session, giving a reliable, real-time activity feed without abandoning the interactive TUI.

## What Changes

- Replace the single-purpose `question-hook.cjs` with a generalized **`event-hook.cjs`** wired to the full event set: `SessionStart`, `UserPromptSubmit`, `PreToolUse(*)`, `PostToolUse(*)`, `Notification`, `Stop`, `SubagentStop`, `SessionEnd`. It normalizes each event (including a cheap tool-input summary) and delivers it over a **Rust-hosted Unix-domain socket**, failing silently so Claude is never blocked.
- Host the socket in the Tauri backend: accept → parse → emit `overview://event` to the frontend, buffer in a per-pane ring, and **append to a durable JSONL sink** `events/<sessionId>.jsonl`.
- Make hook events the **primary source of truth** for session status and a **full per-tool activity timeline** with a live `currentAction` label; demote the PTY-byte heuristic to a fallback.
- Make transcript content reads **event-triggered** (on `Stop`/`PostToolUse`) with a slow ~5s safety poll. **BREAKING (internal):** remove the fixed 1.5s `activity_for` poll cadence.
- Persist the timeline across app restarts / `claude --resume` via the durable sink, keyed by `sessionId`, with **pruned retention** (30-day / ~5MB-per-session, tunable) and transcript-based backfill for pre-existing sessions.
- **BREAKING (internal):** retire the `*.question.json` sidecar and `read_pending_questions`; the pending `AskUserQuestion` now arrives as a `PreToolUse[AskUserQuestion]` event payload.
- Demote the statusline-wrapper snapshot to a **non-critical cost/model source** only; no derived status depends on it.

## Capabilities

### New Capabilities
- `activity-events`: capture of Claude Code hook lifecycle events via `event-hook.cjs`, transport over a Rust-hosted Unix socket, the durable per-session JSONL sink, retention/pruning, and rehydration on startup/resume.
- `activity-timeline`: event-sourced session status and `currentAction` derivation, the per-tool activity timeline surfaced in the overview, and the demotion of the statusline snapshot and PTY-byte heuristic to non-authoritative roles.

### Modified Capabilities
<!-- The overlapping in-flight capabilities (task-detection, agent-overview) are not yet
     archived to openspec/specs/, so there are no established specs to delta against.
     Their superseded behaviors are tracked under Impact and reconciled on archive. -->

## Impact

- **New files:** `src-tauri/resources/event-hook.cjs`, `src-tauri/src/events.rs`, `src/lib/overview/events.svelte.ts`.
- **Modified:** `src/lib/usage/spawn.ts` (`buildSpawnOverride` — inject `AGENT_DESKTOP_SOCKET_PATH`, register the full hook set), `src-tauri/src/lib.rs` (register the socket server + `events_for` command, add `socket_path` to `usage_paths`), `src/routes/+page.svelte` & `src/lib/overview/activity.svelte.ts` (event-triggered reads + 5s safety poll), `src/lib/overview/runtime.ts` / `view.svelte.ts` / `roster.ts` (event-sourced status, `currentAction` on `AgentRow`).
- **Removed:** `src-tauri/resources/question-hook.cjs`, the `*.question.json` sidecar, `read_pending_questions`, the fixed 1.5s poll.
- **Supersedes (in-flight `add-agent-desktop`):** the snapshot-heartbeat live/idle classification and pending-question sidecar described by `task-detection`/`agent-overview` are replaced by event-sourced status; to be reconciled when `add-agent-desktop` archives.
- **External dependency:** Claude Code hook event names/payloads (confirmed against CLI v2.1.162). No new third-party packages.
