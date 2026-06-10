## Context

Agents run as `claude` CLI sessions in PTY panes (`PaneSession` in
`src/lib/layout/workspace.svelte.ts`), bound to a `Project`
(`src/lib/projects/projects.ts`) by `projectId`, spawned through
`src/lib/usage/spawn.ts` + the launcher. Agent state (newest message, context %,
pending `AskUserQuestion`) is derived in `src-tauri/src/activity.rs` and via a
hook-fed event socket in `src-tauri/src/events.rs` (emitted as `overview://event`).
App data (projects, tasks, settings) is JSON under app-data, loaded/saved through
Tauri commands in `src-tauri/src/lib.rs`.

Two architectural facts drive this design:

1. **The pane registry is frontend-owned.** The pane tree, roster, and archive
   state live in Svelte stores. **PTY I/O, transcript reading, and sockets are
   Rust-owned.** Any operation that creates, messages, reads, or archives a pane
   must ultimately execute in the frontend; Rust is the transport and the host for
   hooks/sockets.
2. **A separate, planned change exists: `add-project-coordinator`.** It already
   designed a per-project coordinator pane, a control socket, and an
   agent-management MCP toolkit — but framed around *governance* (agents escalate
   questions; the coordinator answers/defers under guardrails). This change
   extracts the shared substrate (socket + toolkit + "agent = spawnable pane") so
   both consume it, and ships the substrate itself plus a *minimal* coordinator
   focused on *proactive* orchestration. Governance is layered on later.

Specialists do not exist today; `.claude/agents/` is empty in this repo.

## Goals / Non-Goals

**Goals:**
- A project-scoped library of **specialists** stored as native
  `.claude/agents/<name>.md` files, editable through a form + prompt editor.
- A **shared orchestration runtime**: control socket ↔ frontend executor + a
  bundled stdio MCP toolkit, operating over **all** `claude` agent panes in a
  project (spawned specialists *and* the user's pre-existing sessions).
- The ability to **spawn a pane as a specialist** (compose its launch from the
  file) and to attribute such panes in the roster.
- A **dedicated per-project coordinator** that dynamically orchestrates
  specialists and existing sessions toward a goal, end-to-end.
- Be **self-contained** and **additive**: a project with no coordinator /
  specialists behaves exactly as today.

**Non-Goals:**
- Governance: escalation, `ask_coordinator`, implicit interception,
  hybrid autonomy, hard guardrails, `answer_question` (all → `add-project-coordinator`).
- User-level `~/.claude/agents`; cross-project coordination; coordinator
  hierarchies; non-`claude` agents; stored or GUI-built workflow pipelines;
  provider-agnostic agents.

## Decisions

### D1. Specialist = native `.claude/agents/<name>.md` (project scope), edited via a form
The app reads/writes project-scope subagent files directly. Frontmatter carries
`name`, `description`, optional `tools`, optional `model`; the markdown body is
the system prompt. The Specialists panel presents a **form** (fields) + a
**prompt editor** (body) and (de)serializes the `.md` (YAML frontmatter + body).
*Why:* the file is the real Claude Code primitive, so the same definition powers
both app-spawned panes and Claude's native Task delegation — no parallel concept.
*Alternative rejected:* an app-owned `specialists.json` injected at spawn — it
would diverge from Claude's own subagent mechanism and not be usable by Task.

### D2. Toolkit transport: MCP adapter ↔ Rust control socket ↔ frontend executor
A bundled Node stdio MCP server (same family as `resources/event-hook.cjs`) is
attached to the coordinator session. Each tool call is forwarded over a **new Rust
control socket** (mirroring `events.rs`) as a JSON request with an id and a
per-request timeout. Rust emits a `orchestration://request` Tauri event; the
frontend executes using existing functions (launcher spawn, `pty_write`, archive,
roster/activity reads) and replies via a new `orchestration_reply` Tauri command,
which Rust routes back to the waiting socket request and on to the MCP result. A
small Rust-side **serialization queue** per target prevents interleaved injections.
*Why:* the pane registry is frontend-owned, so the executor must be the frontend;
Rust is the natural socket host and already owns the analogous events socket.
*Alternative rejected:* a Rust-side MCP sidecar — it still cannot mutate the
frontend pane tree, so it needs the same round-trip; Node keeps parity with the
existing hook tooling. (This is `add-project-coordinator`'s D2, generalized and
made the shared substrate.)

### D3. Toolkit is project-scoped over ALL agent panes, including existing user sessions
Tools: `spawn_agent(prompt, specialist?, cwd?)`, `message_agent(paneId, text)`,
`read_agent(paneId)`, `list_agents()`, `inspect_agent(paneId)`,
`archive_agent(paneId)` / `unarchive_agent(paneId)`. Every op is bounded to the
coordinator's `projectId`; targeting a pane outside the project, or
closed/nonexistent, is rejected by the executor. `list_agents` returns **every**
`claude` agent pane in the project — those the coordinator spawned *and* those the
user started by hand — so the coordinator can weave current work into a workflow.
*Why:* the user explicitly wants the orchestrator to interact with their current
sessions, not only ones it spawns.
*Note:* `answer_question` is deliberately **excluded** here (governance).

### D4. `spawn_agent(specialist)` composes the launch from the specialist file
When `spawn_agent` is given a specialist, the executor resolves
`.claude/agents/<name>.md` and composes the `claude` launch from it. **Spike
resolved (claude 2.1.168):** the CLI exposes `--append-system-prompt <prompt>`,
`--system-prompt <prompt>`, `--model <model>`, `--allowedTools <tools...>`,
`--disallowedTools <tools...>`, `--mcp-config`, and `--settings` — so direct
composition works and the `initialInput` persona-preamble fallback is **not
needed**. The chosen mapping (specialist file → launch args), a pure helper:

- body → `--append-system-prompt "<body>"` (append the persona to Claude Code's
  default prompt rather than `--system-prompt`, so base tool behavior is kept)
- frontmatter `model` (when present) → `--model <model>`
- frontmatter `tools` (when present) → `--allowedTools <tools...>`

The spawned pane records its specialist so the roster can badge it.
*Why:* keeps the `.md` file the single source of truth while still producing a
real, visible, standalone pane (not an invisible Task subagent).

### D5. Coordinator = a minimal `claude` pane, started on demand, persistent, reused
The coordinator is an ordinary `PaneSession` with `program: 'claude'`, marked with
a `role: 'coordinator'` flag and back-referenced from the `Project`
(`coordinatorSessionId`). A per-project "Start coordinator" affordance launches it
with the toolkit MCP config attached and an **orchestrator** system prompt (its
job: take a goal, plan, spawn/coordinate specialists and existing sessions). At
most one per project; starting again focuses/reuses the existing one; it persists
for the app session and is identifiable after focus changes/restart.
*Why:* reuses `pty.rs`, `PaneSession`, `activity.rs`, the event hook, the roster,
and usage tracking for free; the "TUI" is claude's own terminal UI. This is
`add-project-coordinator`'s D1/D8, trimmed to the proactive-orchestration core.

### D6. Dynamic workflows are ephemeral and live entirely in the coordinator's reasoning
There is no stored workflow object and no builder UI. A "workflow" is whatever the
coordinator does in one goal-driven session: it calls the toolkit to spawn
specialists, message/read them and existing sessions, and iterate to completion.
*Why:* matches the user's "dynamic, Claude-in-session coordinates" intent and
avoids a heavyweight pipeline model.

### D7. Observability via the existing roster; attribute specialist + coordinator
Coordinator-spawned and coordinator-driven agents are **real panes**, so they are
already surfaced by `activity.rs` + the roster. We add attribution: a spawned
pane's specialist identity and the coordinator that spawned it are recorded on the
pane and shown in the overview/roster (badge/grouping).
*Why:* "see multi-agent runs" needs only attribution, not a new watcher; the
`subagents.rs` watcher (which reads only Workflow-tool `workflows/*.json` records)
is orthogonal and out of scope here.

### D8. Extract the shared runtime from `add-project-coordinator` (planning edit)
Edit that change's delta specs so its `coordinator-toolkit` keeps only governance
(`answer_question` + guardrails) and its `project-coordinator` references
`agent-orchestration-runtime` for the socket + spawn/message/read/list/inspect/
archive, instead of re-specifying them. No toolkit spec is duplicated across the
two changes.
*Why:* the user approved editing that (unbuilt) change; avoids two sources of
truth for the same transport + toolkit.

## Risks / Trade-offs

- **`spawn_agent(specialist)` CLI mechanism is unproven** → Spike the `claude`
  flags early (D4); fall back to an `initialInput` persona preamble if direct
  system-prompt injection is unavailable. Gate the rest of the change on the spike.
- **Injecting input into a busy session garbles it** → Queue and deliver
  `message_agent` injections when the target is idle (gate on activity/events
  state); a Rust-side per-target serialization queue prevents interleaving.
- **Round-trip latency / races** (MCP → socket → event → frontend → reply) →
  Request ids with per-request timeouts; the executor replies with structured
  errors that surface to the coordinator as tool failures.
- **Acting on the user's live sessions is surprising** → Toolkit ops are
  project-scoped and rejected outside the project; the coordinator is started
  explicitly by the user, so its reach is opt-in per project.
- **Editing `.claude/agents/*.md` can produce invalid frontmatter** → The form
  owns (de)serialization and validates `name` (unique, filename-safe) before
  write; malformed files surface as a read error rather than crashing the panel.
- **Two-change coupling** (this + re-scoped coordinator) → Keep the runtime spec
  authoritative; the coordinator change only references it. Verified by
  `openspec validate` on both.

## Migration Plan

Additive only. No behavior changes for a project without a coordinator or
specialists. The Specialists panel appears but is empty until the user creates
one. Ships on the current `add-voice-input` branch (no new branch, per the user).
Rollback = remove the panel + runtime wiring; `.claude/agents/*.md` files are
inert to the rest of the app.

## Open Questions

- ~~Exact `claude` CLI flags for specialist composition (D4)~~ — **resolved**
  (claude 2.1.168): `--append-system-prompt` + `--model` + `--allowedTools`; no
  fallback needed. See D4.
- Idle-detection signal precise enough to gate injections (D-risk) — reuse
  activity/events "needs input / running" state; confirm during build.
