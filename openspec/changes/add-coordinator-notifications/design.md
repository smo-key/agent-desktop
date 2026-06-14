## Context

The per-project coordinator is a `claude` pane launched with the
`agent-orchestration-runtime` toolkit and `ORCHESTRATOR_SYSTEM_PROMPT`
(`src/lib/orchestration/coordinator.ts`). Today its prompt instructs it to
"Poll their status with `list_agents`/`read_agent`", so after delegating it must
loop on toolkit calls to learn anything — burning tokens and context — or stop
and go blind. Toolkit ops run through `OrchestrationExecutor`
(`executor.svelte.ts`), which already injects turns into a pane's PTY via
`sendToPane` with an idle gate (`BUSY_WAIT_MS`/`BUSY_POLL_MS`). Agent lifecycle
events (`Stop`, `SubagentStop`, `SessionEnd`) already flow
hooks → unix socket → frontend, landing in the overview events/activity stores;
status (`working`/`idle`/`waiting`) and pending-question state are already
derived there. Spawned panes already carry `coordinatorPaneId`; `PaneSession`
already carries `role`/`specialist` markers.

The gap is purely **outbound**: nothing turns those already-present events into a
turn injected back into the coordinator. Because the frontend owns both the event
stream and the pane registry, this can be solved entirely in the frontend.

## Goals / Non-Goals

**Goals:**
- The coordinator delegates, **yields**, and is woken only by events — no polling
  loop.
- Opt-in-by-default completion notifications (`notifyOnComplete`, default `true`)
  carrying the agent's final message.
- An always-available `message_coordinator` tool for agents to push updates.
- Durable, coalesced, idle-gated delivery into the coordinator pane.

**Non-Goals:**
- Governance / escalation (pending-question routing, guardrails, hybrid
  autonomy) — owned by `add-project-coordinator`. A pending `AskUserQuestion` is
  explicitly **not** "completion" here.
- Any new Rust socket / command / server-push. No backend changes.
- Cross-project notification or coordinator hierarchies.

## Decisions

### D1. The notifier lives in the frontend and reuses `sendToPane`
A new `coordinator-notifier.svelte.ts` subscribes to the existing events/activity
stores, builds notifications, and injects them via the existing `sendToPane`.
*Why:* completion signals already arrive in the frontend and pane injection is
already a frontend capability, so a Rust server-push channel would be pure
overhead. *Alternative rejected:* extend the Rust control socket to push
notifications down to the MCP adapter and have the coordinator drain them — more
plumbing, and it cannot inject a turn without the frontend anyway.

### D2. Completion = working→idle with no pending question, re-armed per turn
The watch fires when a notify-on-complete agent transitions `working → idle` and
has no pending `AskUserQuestion`, then re-arms on its next `working` transition
(one ping per completed turn). A terminal ping also fires on `SessionEnd`.
*Why:* this is the signal a coordinator actually wants ("the agent finished what
I asked and is awaiting next steps"), and it is already derivable from the event
store. *Alternative rejected:* fire only on `SessionEnd` — misses agents that
finish a turn and sit idle awaiting instructions (the common orchestration case).
A pending question is deliberately excluded; routing those is governance scope.

### D3. `notifyOnComplete` defaults to `true`, stored on the pane
`spawn_agent` accepts `notifyOnComplete?: boolean` (default `true`), persisted on
`PaneSession` next to `role`/`specialist`/`coordinatorPaneId`. *Why default true:*
in the yield-and-be-woken model, a coordinator that forgets the flag would sleep
with no wake; defaulting on keeps liveness safe, and `false` is the explicit
opt-out for fire-and-forget helpers the coordinator will archive anyway.

### D4. `message_coordinator` is an executor op; spawned agents get a 1-tool MCP config
Spawned agents currently receive no orchestration MCP config. We attach a minimal
config exposing only `message_coordinator`, carrying the agent's own paneId and
its spawning coordinator's paneId. The op is handled by the executor (same
`orchestration://request` path), which resolves the target coordinator (spawner,
falling back to the project coordinator), then enqueues the update in the
notifier. No coordinator running → structured error returned to the agent.
*Why:* keeps the agent surface tiny and reuses the existing request/reply
transport; routing/error live with the other ops, delivery mechanics live with
the notifier.

### D5. Durable per-coordinator queue with coalescing and idle gating
The notifier keeps a queue keyed by coordinator paneId. Notifications produced
while the coordinator is busy are **held** (not bounded-waited-then-errored like
`message_agent`) and drained when the coordinator goes `working → idle`; all
currently-queued items are **coalesced** into one injected turn. Delivery is
idle-gated (never into a mid-turn or menu-bound coordinator) and serialized per
coordinator. *Why:* a coordinator can be busy for a long time spawning/planning;
erroring would lose updates, and one-turn-per-event would spam its input.

### D6. Pure core, framework-free, unit-tested
The load-bearing logic — message formatting, queue/coalesce, working→idle re-arm,
terminal-on-`SessionEnd` — is a pure module (mirroring how `coordinator.ts` is
unit-tested without a live workspace). The `.svelte.ts` wrapper only wires the
stores and `sendToPane`.

### D7. Prompt rewrite: yield, don't poll
`ORCHESTRATOR_SYSTEM_PROMPT`'s "How to work" replaces "Poll their status…" with:
delegate, then **end your turn**; you will be woken by `message_coordinator`
updates and `notifyOnComplete` completions; leave `notifyOnComplete` at its
default (`true`) — or set it — for agents whose completion you must act on.
`request_user_input` / `AskUserQuestion` semantics are unchanged, and the roster
already does not flag an idle coordinator as needs-you.

## Risks / Trade-offs

- **Missed wake if both channels silent** (agent never completes, never messages,
  `notifyOnComplete:false`) → coordinator sleeps. Mitigation: default `true`; the
  prompt tells the coordinator to keep notify-on-complete for anything it must
  act on; the user can always type into the coordinator pane.
- **Status flap producing spurious completions** (working↔idle jitter) →
  duplicate pings. Mitigation: re-arm only on a genuine `working` transition; the
  derived status already has hysteresis upstream; coalescing absorbs bursts.
- **Coalesced turn too large** (many agents finish while coordinator is busy) →
  one big injected turn. Mitigation: each item is a one-line summary + final
  message; acceptable for v1.
- **Final-message extraction** depends on the activity store's last-message
  derivation; if empty, the notification still identifies the agent and its
  status so the coordinator can `read_agent`.

## Migration Plan

Additive and frontend-only. Projects without a coordinator are unaffected; the
notifier no-ops when no coordinator is running. Rollback = revert the notifier
wiring and the prompt change; `notifyOnComplete` becomes inert. No data migration.

## Open Questions

None outstanding — `notifyOnComplete` default (`true`) and completion semantics
(working→idle, re-armed, plus `SessionEnd`) are settled.
