## Why

Users repeatedly run the same project commands (start the dev server, run tests,
git push) and the same Claude prompts. Today the right-docked **Terminals** panel
lets you spin up ad-hoc terminals with a `+`, but there is no first-class,
named, project-scoped notion of a reusable "task" — nor any way to capture a
recurring Claude prompt as a one-click launch. We want to promote the existing
project-terminals primitive into a **Tasks** concept: named runnable things,
scoped to a project, that run either as a terminal command or as a Claude agent
prompt, with clear start/stop and success/error feedback.

## What Changes

- **New left "Tasks" panel** docked at the bottom of the Agents panel
  (~⅓ height, with a draggable splitter between the Agents rail above and Tasks
  below). List-style UI mirroring the Agents rail; shows the active project's
  tasks. Footer actions: `[+ Task]` (create a task) and `[⊳ Terminal]` (launch a
  bare interactive shell).
- **Task model** — evolve the existing project-terminals model into a tasks
  model: a task is a `name` plus a `kind` of either `terminal` (a shell
  `command`) or `agent` (a Claude `prompt`), scoped to a `projectId`. Tasks can
  be started and stopped and report status running / succeeded / failed.
  - **BREAKING (internal):** `src/lib/terminals/*` (`projectTerminals`,
    `TerminalsPanel`, `terminals.json`, `terminals_load`/`terminals_save`) is
    renamed/evolved into `src/lib/tasks/*` (`projectTasks`, the panels,
    `tasks.json`, `tasks_load`/`tasks_save`). The persisted store gains
    `kind`/`prompt`. This is internal app state with no external consumers.
- **Terminal-kind tasks run in the right-docked panel**, which is **renamed
  "Tasks"** and **loses its `+` button**. On completion: exit 0 → the pane
  auto-closes; non-zero exit → the pane stays open, marked failed (red), and is
  dismissable. Long-running tasks (e.g. *Start Dev Server*) stay until stopped.
- **Agent-kind tasks** launch a normal Claude session in the **main workspace +
  Agents rail** (not the right panel), seeded with the task's prompt.
- **Bare interactive shells** (no command) remain launchable via **⌘Y** and a
  blue `＋` button in the right-docked **Terminals** panel header, and keep
  today's persist-on-exit behavior — a bare terminal is explicitly *not* a task.
- **Create/edit happen in a modal dialog** (modeled on the New session dialog),
  not inline: the launcher header's blue `＋` and **⌘T** open it. A task **name
  is required**; the command field is monospace. **Deleting** a task requires
  confirmation.

## Capabilities

### New Capabilities
- `project-tasks`: The per-project task model and store — task definitions
  (`id`, `name`, `projectId`, `kind`, `command?`, `prompt?`), persistence,
  runtime/lifecycle state (running / succeeded / failed), start/stop, and the
  auto-close-on-success / keep-open-on-error rules. Supersedes the
  project-terminals model, retaining bare-terminal behavior.
- `tasks-panel`: The two panel surfaces — the new bottom-left **Tasks launcher**
  (list UI, splitter under the Agents rail, create/start/stop, `[+ Task]` /
  `[⊳ Terminal]` footer) and the renamed right-docked **Tasks** panel (running
  terminal-kind tasks, no `+`, success/error close behavior). Routing of
  agent-kind tasks to a workspace session.

### Modified Capabilities
<!-- openspec/specs/ is currently empty (the app is pre-archive); no durable
     specs exist to modify. The project-terminals / terminals-panel capabilities
     live only in the unarchived add-terminals-panel change and are superseded
     here. See Impact. -->

## Impact

- **Supersedes the unarchived `add-terminals-panel` change.** Its
  `project-terminals` / `terminals-panel` capabilities are evolved into
  `project-tasks` / `tasks-panel`. When both eventually archive into
  `openspec/specs/`, the durable specs should reflect the tasks model, not the
  older terminals model.
- **Frontend:** rename/evolve `src/lib/terminals/` → `src/lib/tasks/`
  (`projectTerminals.ts` + `.svelte.ts`, `TerminalsPanel.svelte`,
  `activeProject.ts`, `panel.svelte.ts`); new bottom-left launcher component +
  splitter in/under `src/lib/layout/SessionRail.svelte`; wiring in
  `src/routes/+page.svelte` (right-panel rename, remove `+`, ⌘T, badge,
  agent-task → workspace session launch).
- **Backend:** rename `terminals_load`/`terminals_save` → `tasks_load`/
  `tasks_save` and the on-disk file `terminals.json` → `tasks.json`
  (`src-tauri/src/lib.rs`).
- **Reuses, unchanged:** PTY spawn (`pty_spawn`/`pty_kill`), the Claude
  session-launch path (`workspace.svelte.ts`), projects model
  (`projects.ts`), and the resize `Gutter` / flex-ratio primitives.
