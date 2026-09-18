## Context

Status is event-sourced (`deriveEventActivity` in `src/lib/overview/events.ts`): a tool in flight → `working`; otherwise the last non-`SubagentStop` turn-boundary event classifies, and `Stop` → `waiting`. The needs-input alert (`newlyNeedsAttention`) fires on any live row entering `waiting`. The hook script (`event-hook.cjs`) normalizes each hook's stdin into a compact event; Rust `events.rs` deserializes it into `AgentEvent` (unknown JSON keys are dropped), rings it, emits `overview://event`, and appends it to the durable per-session sink that the frontend re-seeds from every ~5 s.

A live probe (claude 2.x, `-p` with a stdin-dumping hook) of a `run_in_background` Agent produced this sequence on the parent session: `PreToolUse[Agent]` → `SubagentStart{agent_id}` → `PostToolUse[Agent]` (`tool_response.status: "async_launched"`, 8 ms later) → `Stop{background_tasks:[{id, type:"subagent", status:"running", description, agent_type}]}` → … → `SubagentStop{agent_id, background_tasks:[…running…]}` → `Stop{background_tasks:[]}`. So the parent's own `Stop` already states whether background work is pending.

## Goals / Non-Goals

**Goals:**
- A session with running background tasks never reads Needs you and never triggers the needs-input alert until it is genuinely idle.
- Zero behavior change when the field is absent (older claude, Copilot, synthetic interrupt `Stop`s).

**Non-Goals:**
- Tracking background *Bash* tasks that claude does not list in `background_tasks` (none appeared in the probe; if claude lists them, they are covered automatically since any `running` entry counts).
- Pairing `SubagentStart`/`SubagentStop` ids in the frontend (superseded by the authoritative `Stop` payload; no new hook subscription is needed).
- Changing the terminal-busy screen-scrape or the PTY fallback.

## Decisions

**Decision: use the `Stop` payload's `background_tasks` as the sole signal, not `SubagentStart` bookkeeping.**
It is emitted by claude itself at exactly the moment we classify, needs no cross-event pairing, self-heals (the next `Stop` restates the full list), and cannot be desynchronized by a lost `SubagentStop`. A `SubagentStart` subscription would add an event to the hook set and a stateful start/stop ledger that goes stale if one event is dropped.
- *Alternative — feed the `subagents.rs` filesystem watcher into `rowFor`:* file-polling latency and a second source of truth; rejected.
- *Alternative — a "N background task(s)" terminal marker:* output-driven sampling lapses while the parent is quiet (the 3 s busy grace); rejected.

**Decision: compact the array in the hook to `{id, type, status, description}`, forwarded on `Stop` and `SubagentStop`; only entries with `status === "running"` count.**
Keeps sink lines small and stable. `SubagentStop` gets the field too for timeline display, but classification still skips back over `SubagentStop` to the last real boundary, so a finishing subagent that still lists itself as running cannot flip the parent (the next `Stop` decides).

**Decision: classification rule.** In the `Stop` branch of `deriveEventActivity`: if `runningBackgroundTasks(last).length > 0` → `status: 'working'`, `currentAction: "Background: <description>"` (first running task; `"N background tasks"` when several). Otherwise unchanged (`waiting`). The `inFlight` tracker is untouched, so foreground tools still dominate.

**Decision: Rust `AgentEvent` gains `background_tasks: Option<Value>` (serde default, skip-if-none).** Mirrors `question: Option<Value>` — the backend stores and forwards, never interprets.

## Risks / Trade-offs

- [Claude never sends the closing `Stop` (crash/kill)] → PTY exit is authoritative for `finished`/`error`, unchanged. If the process lives but the final `Stop` is dropped, the periodic sink re-seed restores it (it was persisted by the socket server); only a hook that failed to deliver at all would leave the row `working` until the next event — the same exposure any event already has.
- [A user-interrupted background task] → claude emits a fresh `Stop` with the updated list on the interrupt turn.
- [Field shape drifts in a future claude] → the reader tolerates a non-array / entries without `status` (treated as no running tasks → today's behavior).
