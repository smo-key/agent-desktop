## Context

agent-desktop runs Claude Code as an interactive PTY (the real TUI renders in an xterm; users type into it directly). It observes session state from the side via a statusline-wrapper snapshot, a 1.5s transcript-tail poll (`activity_for`), a `question-hook.cjs` sidecar for pending questions, and a PTY-byte activity heuristic (`runtime.ts`). These signals are of uneven reliability: the statusline stops re-rendering while Claude waits, the transcript poll is laggy and cannot observe an unanswered `AskUserQuestion`, and PTY bytes only yield a coarse working/waiting guess.

The full approved design is at `docs/superpowers/specs/2026-06-03-agent-activity-event-pipeline-design.md`. This document records the technical decisions; the proposal records motivation; the specs record required behavior.

**Hard constraint:** `--output-format stream-json` / `--include-partial-messages` / `--include-hook-events` only work with `-p`/`--print` (headless) and are mutually exclusive with the interactive TUI — `stdout` is either the TUI or the JSON stream. The reliable structured signal for an interactive session is therefore **hooks + the transcript**, not stdout.

## Goals / Non-Goals

**Goals:**
- Deterministic, real-time, event-driven session status and a full per-tool activity timeline, while keeping the interactive TUI.
- Make hook events the authoritative source for status and `currentAction`; make transcript reads event-triggered.
- Survive app restarts and `claude --resume`: the activity timeline rehydrates from disk.
- Never block or slow Claude because of the observability layer.

**Non-Goals:**
- Headless / stream-json interaction model (explicitly rejected; keeps the TUI).
- Dropping the statusline wrapper or computing cost from a pricing table (rejected — maintenance burden).
- Cross-machine / cloud sync of the event log.
- A new third-party dependency.

## Decisions

### D1 — Keep the interactive TUI; enrich the side-channel
Observe via an expanded hook set rather than switching to headless stream-json. *Alternative:* headless stream-json with a custom chat UI — rejected: a full rewrite of the interaction model for no UX gain, and it would discard the real Claude TUI users rely on.

### D2 — Transport over a Rust-hosted Unix-domain socket
The hook script connects per invocation, writes one JSON line, exits. *Alternatives:* (a) append-only JSONL log + FS watcher — added tens-of-ms latency; reused only as the persistence sink (see D5). (b) state sidecar files — no history, concurrent-write races. The socket wins on latency, and because the app always runs when it spawns Claude (PTY children die with the app, so a session never outlives the app) the socket's usual "lost if app down" downside does not apply.

### D3 — One generalized `event-hook.cjs` for the full event set
Wired to `SessionStart`, `UserPromptSubmit`, `PreToolUse(*)`, `PostToolUse(*)`, `Notification`, `Stop`, `SubagentStop`, `SessionEnd`. It produces a cheap tool-input summary (`Bash:<cmd head>`, `Edit:<basename>`, `Task:<subagent_type>`, MCP → tool name) and carries the `AskUserQuestion` payload directly. *Alternative:* many small hooks — more spawn overhead and more wiring for no benefit.

### D4 — Events are the source of truth for status; transcript supplies content, event-triggered
Hooks say precisely *when* and *what kind*; the transcript supplies message *content*. Read the transcript on `Stop`/`PostToolUse` (plus a ~5s safety poll) instead of a fixed 1.5s timer. The pending question is the one case where the hook itself carries content (it isn't in the transcript until answered). The PTY-byte heuristic is demoted to a fallback; PTY `exit` stays authoritative for crash/exit-code.

### D5 — Durable JSONL sink behind the live socket, keyed by sessionId, pruned
On each received event Rust appends to `events/<sessionId>.jsonl` (the in-memory ring is a hot cache). Keyed by `sessionId` (persisted in the workspace registry, matches the transcript filename) so it rehydrates on resume. Retention: prune logs for sessions untouched > 30 days; cap a single log at ~5MB (truncate from the head). Both tunable. Pre-existing sessions backfill a completed-tool timeline from the transcript on first open. *Alternative:* in-memory only — rejected (timeline lost on restart, the very data this change adds). Pure transcript reconstruction — rejected as the primary (loses live-only events like `Notification` and in-flight ordering; needs a heavier parser).

### D6 — Demote, don't remove, the statusline snapshot
Keep the wrapper as a non-critical source for running cost and model; nothing's derived status depends on it. *Alternative:* remove it and price from token usage — rejected (pricing-table maintenance and billing drift).

## Risks / Trade-offs

- **Hook spawn overhead per event** → keep `event-hook.cjs` minimal and synchronous; the script does no I/O beyond a single short-timeout socket write and exits 0 on any error.
- **Stale or absent socket (app closed/restarting)** → hook connect-times-out (~200ms) and silently no-ops; Claude is never blocked. Rust unlinks and recreates a stale socket on boot.
- **Event volume from `PreToolUse(*)`/`PostToolUse(*)`** → bounded per-pane ring (~500) in memory; the durable sink is pruned by age and size.
- **Out-of-order / interleaved events (subagents)** → events carry a receive-time stamp; strict global ordering is not required since tools run serially per session and subagents are keyed by session.
- **Two in-flight changes describe overlapping status behavior** (`add-agent-desktop` is unarchived) → this change adds new capabilities rather than delta-ing unarchived specs; the superseded snapshot-heartbeat/sidecar behavior is reconciled when `add-agent-desktop` archives.
- **Malformed hook payload across CC versions** → Rust drops unparseable lines; the hook tolerates missing fields and degrades to `tool_name` for the summary.

## Migration Plan

1. Land `event-hook.cjs` + the Rust socket server + durable sink behind the existing spawn path; register the full hook set in `buildSpawnOverride`.
2. Switch status/`currentAction`/timeline consumers to the event store; keep PTY-byte status as fallback.
3. Replace the 1.5s poll with event-triggered reads + 5s safety poll.
4. Remove `question-hook.cjs`, the `*.question.json` sidecar, and `read_pending_questions`.
5. **Rollback:** revert `buildSpawnOverride` to the old hook wiring; the socket server and event store are inert without registered hooks, and the transcript/statusline paths still function.

## Open Questions

- **UI surface** for the new data (inline `currentAction` label vs. expandable per-agent timeline panel). Default: both — inline always, timeline on click. Resolve during implementation; does not block specs.
- **Retention defaults** (30 days / ~5MB) are starting values; confirm against real disk usage after first use.
