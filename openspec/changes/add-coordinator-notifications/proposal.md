## Why

After delegating work, the per-project coordinator has nothing to do but
discover when its agents make progress — and today the only way it can is to
poll: its system prompt tells it to "Poll their status with
`list_agents`/`read_agent`". That tight loop burns tokens and context window for
no new information, and when the coordinator stops polling it simply stalls,
blind to agents that have finished or have something to report. The coordinator
should instead **yield after delegating and be woken by events**.

## What Changes

- **Completion notifications (opt-in per spawn, default on).** `spawn_agent`
  gains a `notifyOnComplete` parameter that defaults to `true`. A watched agent
  that transitions from working to idle **without a pending question** causes one
  turn to be injected into its coordinator's pane —
  `[orchestration] Agent "<title>" (pane <id>) finished its turn. Final message: "…"` —
  carrying the agent's last transcript message. It re-arms on the agent's next
  working transition (one ping per completed turn) and fires a final
  notification on `SessionEnd`. Passing `notifyOnComplete: false` opts out for
  fire-and-forget helpers.
- **Agent-initiated updates (always available).** A new
  `message_coordinator({ text })` toolkit op, exposed to **every
  coordinator-spawned agent** via a minimal MCP config attached at spawn, injects
  `[orchestration] Agent "<title>" (pane <id>) says: "<text>"` into the
  coordinator pane. It routes to the spawning coordinator (falling back to the
  project's coordinator) and returns an error when no coordinator is running.
  Spawned agents currently receive no orchestration MCP config; this adds a
  `message_coordinator`-only config for them.
- **A coordinator notifier.** A new frontend module subscribes to the existing
  events/activity stores, holds a **durable per-coordinator queue** that persists
  until the coordinator is idle (unlike `message_agent`'s bounded
  wait-then-error gate), **coalesces** all queued notifications into a single
  injected turn when the coordinator goes working→idle, and delivers via the
  existing `sendToPane`.
- **Event-driven coordinator prompt.** `ORCHESTRATOR_SYSTEM_PROMPT` is rewritten
  so the coordinator delegates and then **ends its turn** instead of polling;
  it is told it will be woken by `message_coordinator` updates and
  `notifyOnComplete` completions, and to set `notifyOnComplete: true` (the
  default) for agents whose completion it must act on. `request_user_input` /
  `AskUserQuestion` semantics are unchanged.

Out of scope: governance/escalation (pending-question routing, guardrails,
hybrid autonomy) — that remains the separate `add-project-coordinator` change; a
pending `AskUserQuestion` is explicitly **not** treated as completion here. No
new Rust socket or server-push: the frontend already owns the event stream and
the pane registry.

## Capabilities

### New Capabilities
- `coordinator-notifications`: Event-driven waking of a coordinator — the
  completion watch (working→idle re-arm and terminal `SessionEnd` ping), the
  agent-initiated `message_coordinator` injection, the durable per-coordinator
  queue, notification coalescing, and idle-gated delivery into the coordinator
  pane.

### Modified Capabilities
- `agent-orchestration-runtime`: `spawn_agent` accepts `notifyOnComplete`
  (default `true`) and persists it on the spawned pane; a new
  `message_coordinator` op; spawned agents launch with a `message_coordinator`-only
  MCP config.
- `agent-coordinator-workflows`: the coordinator works event-driven — it yields
  after delegating and is woken by notifications, rather than polling agent
  status in a loop.

## Impact

- **Frontend (`src/lib/orchestration/`):** new `coordinator-notifier.svelte.ts`
  (with a pure, framework-free core) wired to the events/activity stores;
  `executor.svelte.ts` gains the `message_coordinator` op and `notifyOnComplete`
  handling in `spawn_agent`; `coordinator.ts` prompt rewrite and a
  `message_coordinator`-only MCP config for spawned agents.
- **Pane model:** `PaneSession` gains a `notifyOnComplete` marker (alongside
  `role` / `specialist` / `coordinatorPaneId`).
- **No backend changes:** reuses the existing hook→socket→frontend event
  pipeline and `sendToPane`; no new Rust socket, command, or server-push.
- **Additive / no breaking changes:** projects without a coordinator are
  unaffected; the notifier no-ops when no coordinator is running.
