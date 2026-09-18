## Why

When a Claude Code session launches a background subagent (an `Agent` call with `run_in_background`, a background fork, or a workflow) and then ends its own turn, the app reads the parent's `Stop` as "turn complete" and flips the session to **Needs you**, firing a needs-input alert — even though the session is still actively working and will resume on its own when the background agent reports back. The user gets a false "all done" notification and a mis-laned row.

Verified against a live `claude` run: the `Agent` tool's `PostToolUse` fires immediately at launch (`status: async_launched`), the parent's `Stop` follows within seconds, and that `Stop` payload carries a `background_tasks` array listing the still-running subagent with `status: "running"`. Nothing in the app's event vocabulary currently carries that array.

## What Changes

- The event hook forwards the `background_tasks` array (compacted to `{id, type, status, description}`) on `Stop` and `SubagentStop` events; the Rust event struct and the frontend `AgentEvent` gain an optional `backgroundTasks` field, persisted through the durable sink like every other field.
- `deriveEventActivity` treats a `Stop` whose `backgroundTasks` still contains a `running` entry as **not** a completed turn: the session stays `working`, with a current action naming the background work. A later `Stop` with no running background tasks returns it to `waiting` as before.
- Because the row never reads `waiting`, the needs-input alert does not fire until the session is genuinely idle. No change to the notifier itself.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `activity-events`: "Capture Claude Hook Lifecycle Events" — the normalized `Stop`/`SubagentStop` event carries the session's background-task list.
- `activity-timeline`: "Derive Session Status From Events" — a `Stop` with running background tasks yields `working`, not `waiting`.

## Impact

- `src-tauri/resources/event-hook.cjs` (+ its test), `src-tauri/src/events.rs` (`AgentEvent.background_tasks`), `src/lib/overview/events.ts` (+ `events.test.ts`).
- Older `claude` versions that omit `background_tasks` behave exactly as today (field absent → completed turn).
- Copilot sessions are unaffected (no background tasks in their event mapping).
