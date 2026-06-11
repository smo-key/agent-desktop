## Why

The app runs many `claude` agents as panes, but there is no way to define
**reusable agent specialists** or to have one agent **orchestrate** the others.
Every agent is started by hand and works in isolation; the human is the only
coordinator. We want real multi-agent support: a library of specialists the user
can see and create, and a per-project coordinator that — driven conversationally
("Claude-in-session") — dynamically spins specialists up as visible panes and
coordinates them, including the user's already-running sessions, toward a goal.

## What Changes

- **Specialists are native Claude Code subagents.** A specialist is a
  `.claude/agents/<name>.md` file (project scope only): YAML frontmatter
  (`name`, `description`, optional `tools`, optional `model`) plus a markdown body
  that is the system prompt. The file is the single source of truth, so Claude's
  own Task delegation can use it too.
- **New Specialists panel.** A panel (sibling to Projects/Tasks) lists the active
  project's specialists and lets the user **create / edit / delete** them via a
  **form + system-prompt editor** that compiles to/from the `.md` file.
- **Shared orchestration runtime.** A Rust control socket (mirroring the events
  socket) plus a bundled stdio MCP adapter expose a **project-scoped agent
  toolkit** — `spawn_agent`, `message_agent`, `read_agent`, `list_agents`,
  `inspect_agent`, `archive_agent` / `unarchive_agent`. Because the pane registry
  is frontend-owned, the **frontend executes** each op (via the existing launcher
  / `pty_write` / archive / roster) and replies back over the socket. The toolkit
  operates on **every `claude` agent pane in the project**, including the user's
  manually-started sessions — not only coordinator-spawned ones.
- **Spawn a pane *as* a specialist.** `spawn_agent` gains an optional specialist
  argument; the launched `claude` pane is composed from that specialist file
  (system prompt, model, tool scoping) and badged with the specialist's identity
  in the roster.
- **Dedicated per-project coordinator + dynamic workflows.** One `claude`
  coordinator pane per project (started on demand, persistent/reused, recorded on
  the project) is launched with the toolkit attached and an orchestrator system
  prompt. Given a goal, it composes and runs an **ephemeral, dynamic** workflow —
  spawning specialists, and reading/messaging both those specialists and the
  user's existing project sessions — to completion. No stored pipelines, no
  visual builder.
- **Self-contained.** This change carries the runtime and the minimal coordinator
  so it ships end-to-end on its own. `add-project-coordinator` is re-scoped to
  layer **governance** (escalation, hybrid autonomy, guardrails) on top of this
  runtime later; its `coordinator-toolkit` / `project-coordinator` artifacts are
  edited to consume `agent-orchestration-runtime` rather than re-specify the
  socket + spawn/message/read/list/inspect/archive.

## Capabilities

### New Capabilities
- `agent-orchestration-runtime`: the control socket ↔ frontend-executor transport,
  the bundled MCP toolkit adapter, the project-scoped agent-management operations
  (spawn / message / read / list / inspect / archive over all project agent panes,
  including pre-existing user sessions), and the project-scoping + serialization
  guarantees. Excludes `answer_question` and any escalation/guardrail behavior.
- `agent-specialists`: the specialist model (native `.claude/agents/<name>.md`,
  project scope), the Specialists panel (see/create/edit/delete via form +
  prompt editor), and composing a pane launch **as** a specialist.
- `agent-coordinator-workflows`: the dedicated per-project coordinator pane
  (on-demand start, persistence/reuse, project back-reference, orchestrator
  prompt) and dynamic-workflow orchestration over specialists and existing
  sessions, with spawned/coordinated agents attributed to their specialist and
  coordinator in the roster.

### Modified Capabilities
<!-- None in openspec/specs/ (it has only project-tasks, tasks-panel). The
     planning edits to the add-project-coordinator change's delta specs are not
     edits to durable specs; they are tracked as a task in tasks.md. -->

## Impact

- **Frontend (`src/`):** new `src/lib/specialists/` (model + reactive store +
  Specialists panel: list, form, prompt editor); orchestration executor wiring a
  new `*://request` Tauri event to launcher spawn / `pty_write` / archive / roster
  reads + a reply command; coordinator launch path + project binding
  (`projects/`, `launcher/`, `layout/workspace.svelte.ts`); roster attribution
  for specialist + coordinator-spawned agents (`overview/`).
- **Backend (`src-tauri/src/`):** new control socket module (mirroring
  `events.rs`) with request ids / timeouts / a serialization queue; Tauri commands
  to load/save/delete `.claude/agents/*.md` and a `*_reply` command routing
  results back to the socket; coordinator launch wiring through `pty.rs`.
- **New component:** a bundled stdio MCP adapter under `src-tauri/resources/`
  (same Node family as `event-hook.cjs`) exposing the toolkit and forwarding to
  the control socket.
- **Cross-change:** `openspec/changes/add-project-coordinator/` artifacts edited
  to reference `agent-orchestration-runtime` (no duplicated toolkit spec).
- **Key technical unknown (spiked in design):** exact `claude` CLI flags to
  compose a pane as a specialist (`--append-system-prompt`, `--model`,
  `--allowedTools`, `--mcp-config`).
- **Dependencies:** a Node stdio MCP runtime for the adapter; no external
  services. Additive — projects with no coordinator/specialists behave as today.
