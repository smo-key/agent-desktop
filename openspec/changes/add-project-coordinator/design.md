## Context

The app runs agents as `claude` CLI sessions in PTY panes (`PaneSession` in
`src/lib/layout/workspace.svelte.ts`), bound to a `Project`
(`src/lib/projects/projects.ts`) by `projectId`. Agent state — newest message,
context %, and pending `AskUserQuestion` calls — is derived by reading
transcripts in `src-tauri/src/activity.rs` (command `activity_for_panes`) and by
a hook-fed event pipeline over a Unix-domain socket in `src-tauri/src/events.rs`
(emitted to the frontend as `overview://event`). The Inbox roster
(`src/lib/overview/roster.ts`, `Inbox.svelte`) groups agents into lanes;
"Needs you" already aggregates agents with pending questions.

Crucially, the **pane registry is frontend-owned** (the pane tree, roster,
archive state live in Svelte stores), while **PTY I/O and transcript/event
reading are Rust-owned**. Any coordinator action that creates, messages, or
archives a pane must ultimately run through the frontend; Rust is the transport
and the place hooks/sockets land.

## Goals / Non-Goals

**Goals:**
- A per-project coordinator that is a real `claude` pane (the "TUI backing"),
  reusing existing pane/activity/event infrastructure rather than a bespoke
  webview panel or a new TUI framework.
- A toolkit the coordinator can call to manage its project's agents
  (spawn / message / read / answer-question / list / inspect / archive).
- Two escalation paths into the coordinator: an explicit `ask_coordinator` tool
  for project agents, and implicit interception of the existing pending-question
  pipeline.
- Hybrid autonomy: routine/low-risk answered by the coordinator; risky items
  surfaced to the human with context and attribution.

**Non-Goals:**
- Cross-project coordination, coordinator hierarchies / sub-coordinators.
- Coordinating non-`claude` agents (bare terminals).
- A dedicated escalation audit/history UI (transcripts + events suffice for v1).
- Provider-agnostic agents — v1 targets `claude` specifically.

## Decisions

### D1. Coordinator = a `claude` pane launched with an MCP server attached
The coordinator is an ordinary `PaneSession` with `program: 'claude'`, marked as
the project's coordinator (a `role: 'coordinator'` flag and a back-reference on
the `Project`, e.g. `coordinatorSessionId`). It is launched with (a) an MCP
config pointing at a bundled stdio MCP server that exposes the toolkit, and (b)
an appended system prompt defining its role, the hybrid-autonomy policy, and the
hard guardrails.

*Why:* reuses `pty.rs`, `PaneSession`, `activity.rs`, the event hook, the
roster, and usage tracking for free. The "TUI" is claude's own terminal UI.
*Alternative rejected:* a custom ratatui control panel or a headless+wrapper —
both duplicate infrastructure and were declined in scoping.

### D2. Toolkit transport: MCP server ↔ Rust control socket ↔ frontend
The MCP server is a bundled Node stdio script (same family as
`resources/event-hook.cjs`). Each tool call is forwarded over a **new Rust
control socket** (mirroring the events socket in `events.rs`) as a JSON request
with an id. Rust resolves project/pane-owned operations by emitting a
`coordinator://request` Tauri event to the frontend; the frontend executes using
existing functions (launcher spawn, `pty_write`, archive, roster read) and
replies via a new `coordinator_reply` Tauri command, which Rust routes back to
the waiting socket request and on to the MCP tool result.

*Why:* the pane registry is frontend-owned, so the frontend must be the executor;
Rust is the natural socket host and already owns the analogous events socket.
*Alternative rejected:* an MCP server implemented in Rust as a sidecar — it still
cannot mutate the frontend pane tree directly, so it would need the same
round-trip; Node keeps parity with the existing hook tooling.

### D3. Explicit escalation: `ask_coordinator` exposed to every project agent
Every project agent is launched with the MCP config too, but exposing only the
`ask_coordinator` tool. A call routes the question to that project's coordinator
by injecting it as an input turn into the coordinator's claude session (a
`pty_write` to the coordinator pane), tagged with the originating `paneId` so the
coordinator can act on it via the toolkit. If no coordinator is running for the
project, the tool returns a signal that tells the agent to fall back to a normal
`AskUserQuestion` (human).

*Why:* injecting a turn is the simplest way to "give the coordinator work" using
the agent it already is. *Alternative considered:* a `next_escalation` polling
tool the coordinator drains — more robust against races, noted as a possible
upgrade; v1 uses injection with a small Rust-side queue to avoid interleaving.

### D4. Implicit escalation: intercept the pending-question pipeline
When `activity.rs`/`events.rs` detect a pending `AskUserQuestion` (or other
needs-human-input signal beyond the initial prompt) for a **non-coordinator**
agent whose project has a **running** coordinator, the question is routed to the
coordinator first (same injection channel as D3) instead of immediately landing
in "Needs you". The human is the fallback: no running coordinator, or the
coordinator explicitly defers (D6), surfaces it to "Needs you" as today.
Guards against loops: the coordinator's own pane is never intercepted; an item
already routed is not re-routed.

*Why:* reuses the detection that already exists; agents need no changes to be
covered. *Trade-off:* introduces a brief "in coordinator" state for a question
before it may reach the human — handled by attribution + a timeout fallback.

### D5. Coordinator toolkit (project-scoped)
Tools: `spawn_agent(prompt, cwd?)`, `message_agent(paneId, text)`,
`read_agent(paneId)`, `answer_question(paneId, choiceOrText)`,
`list_agents()`, `inspect_agent(paneId)`, `archive_agent(paneId)` /
`unarchive_agent(paneId)`. Every tool is bounded to the coordinator's
`projectId`; targeting a pane outside the project is rejected by the frontend
executor.

### D6. Hybrid autonomy + hard guardrails
The hybrid policy lives primarily in the coordinator's system prompt: answer
routine/low-risk via `answer_question`; otherwise call a `defer_to_human` action
that surfaces the item to "Needs you" with the coordinator's note attached. The
**hard guardrails** are enforced below the LLM: the executor classifies a target
question/action against a fixed guardrail set (destructive/irreversible,
deletions, money, production) and refuses to let `answer_question` resolve such
items autonomously — forcing `defer_to_human`. (See Risks: classification is
heuristic in v1.)

### D7. Human surfaces
- **Own pane:** the coordinator appears and is interactive like any agent.
- **Inbox "Needs you":** deferred/surfaced items appear there attributed to the
  coordinator and the agent they concern (`overview/roster.ts`,
  `activity.svelte.ts`, `events.svelte.ts`).
- **Distinct roster treatment:** the coordinator is badged/lane-distinguished so
  it reads as the project hub, not a normal agent.

### D8. Lifecycle
Started on demand (a per-project "Start coordinator" affordance), then persistent
and reused for the app session; the `Project` records its coordinator session so
it is not duplicated and can be resumed.

## Risks / Trade-offs

- **Hard-guardrail enforcement is heuristic** → Below-LLM classification of
  "risky" questions/actions is pattern-based in v1 and may misclassify. Mitigation:
  default to escalation on uncertainty; keep the guardrail set conservative and
  documented; the coordinator prompt reinforces it.
- **Escalation loops / double-handling** → An intercepted question could bounce
  between agent, coordinator, and human. Mitigation: never intercept the
  coordinator's own pane; mark items as routed; timeout fallback to human.
- **Round-trip latency & races** (MCP → socket → event → frontend → reply) →
  Mitigation: request ids with timeouts; a small Rust-side queue serializes
  injections into a coordinator so turns don't interleave.
- **Injecting turns into a busy coordinator** → Writing to the PTY mid-turn could
  garble input. Mitigation: queue and deliver escalations between turns (gate on
  the coordinator being idle per activity/events state).
- **Orphaned coordinator on crash/restart** → Mitigation: lifecycle records the
  session so it can be detected/resumed or cleanly restarted.

## Migration Plan

Additive only — no change to existing agent/terminal behavior when a project has
no coordinator. Ship behind a per-project opt-in (the "Start coordinator"
action). Rollback = don't start coordinators; the interception path no-ops when
none is running.

## Open Questions

- Should `ask_coordinator` block the calling agent until the coordinator replies,
  or return immediately and let the coordinator drive the answer via
  `answer_question`? (Leaning: return-and-drive, to keep the agent unblocked.)
- Exact representation of the guardrail set and whether any of it should be
  user-configurable per project in v1 (default: fixed, non-configurable).
- Whether to upgrade D3/D4 injection to a drained `next_escalation` queue tool in
  v1 or defer that hardening.
