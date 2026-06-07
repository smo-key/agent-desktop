## Why

As the app scales to many concurrent agents across projects, the human becomes
the bottleneck: every agent that raises an `AskUserQuestion` or otherwise needs
input stalls in the "Needs you" lane until a person answers. There is no
per-project authority that can absorb routine decisions, organize the work, or
spin up help. We need a **coordinator** — a real agent the others escalate to —
so that safe, routine questions get answered without a human, and only the
hard or risky ones reach the person, with full context.

## What Changes

- **Per-project coordinator agent.** Each project can run one coordinator: a
  `claude` CLI session in a PTY pane (its "TUI backing"), reusing the existing
  pane / activity infrastructure. It is **started on demand** and then
  **persists** for the life of the app session; it is reused, never duplicated.
- **Coordinator toolkit (MCP).** The coordinator is launched with an MCP server
  exposing an agent-management toolkit scoped to its project: spawn new agents,
  send input to / read output from existing agents, answer an agent's pending
  question, list and inspect the agents roster, and archive/unarchive agents.
- **Escalation channel.** Other project agents reach the coordinator two ways:
  - **Explicitly** via an `ask_coordinator` tool exposed to every project agent.
  - **Implicitly** by intercepting the existing pending-question / needs-input
    pipeline (`activity.rs` / `events.rs`) and routing it to the coordinator
    first; the human is the fallback when no coordinator is running or the
    coordinator defers.
- **Hybrid autonomy with hard guardrails.** On escalation the coordinator
  answers routine, low-risk items itself (LLM judgment), but a fixed guardrail
  set always forces human review (destructive/irreversible actions, money,
  production, deletions). Deferred items surface to the human.
- **Human surfaces.** The human interacts with the coordinator (a) directly in
  its own pane, (b) through the Inbox "Needs you" lane when the coordinator
  surfaces something — attributed to the coordinator and the agent it concerns —
  and (c) via distinct coordinator treatment in the agents roster.

Out of scope for v1: cross-project coordination, coordinator hierarchies /
sub-coordinators, non-`claude` agents (bare terminals), and a dedicated
escalation audit/history UI beyond what transcripts and events already capture.

## Capabilities

### New Capabilities
- `project-coordinator`: The coordinator agent itself — per-project identity and
  lifecycle (on-demand start, persistence, reuse), launch as a `claude` pane
  with its MCP server attached, and how it is surfaced to the human (own pane,
  Inbox "Needs you" integration, distinct roster treatment).
- `agent-escalation`: How agents escalate to the coordinator — the explicit
  `ask_coordinator` tool, implicit interception of the pending-question /
  needs-input pipeline, routing/fallback rules, and the hybrid autonomy decision
  (LLM judgment plus hard guardrails that force human review).
- `coordinator-toolkit`: The MCP toolkit the coordinator uses to manage its
  project's agents — spawn, message/inject, read output, answer pending
  questions, list/inspect the roster, archive/unarchive — and the project
  scoping that bounds those operations.

### Modified Capabilities
<!-- None: openspec/specs/ is currently empty; all behavior here is new. -->

## Impact

- **Frontend (`src/`):** new coordinator launch path and project binding
  (`projects/`, `launcher/`, `layout/workspace.svelte.ts`); roster + Inbox
  surfacing (`overview/roster.ts`, `overview/Inbox.svelte`); wiring escalations
  into the "Needs you" lane (`overview/activity.svelte.ts`,
  `overview/events.svelte.ts`).
- **Backend (`src-tauri/src/`):** escalation routing and interception in
  `activity.rs` / `events.rs`; new Tauri commands to spawn/message/answer/list
  agents that the MCP server calls into; coordinator process + MCP server
  launch and lifecycle.
- **New component:** an MCP server exposing the coordinator toolkit and the
  `ask_coordinator` tool to project agents, plus the glue that injects it into
  agent launches.
- **Dependencies:** an MCP server implementation/runtime for the toolkit; no
  external services. No breaking changes to existing agent/terminal behavior.
