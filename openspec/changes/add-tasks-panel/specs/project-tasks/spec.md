## ADDED Requirements

### Requirement: Task definition model

A task SHALL be a project-scoped definition with a stable `id`, a human-readable
`name`, a `projectId`, and a `kind` of either `terminal` or `agent`. A
`terminal` task SHALL carry a shell `command`; an `agent` task SHALL carry a
Claude `prompt`. The persisted envelope SHALL key task definitions by project
(`{ version, projects: { [projectId]: TaskDef[] } }`) and SHALL NOT serialize
runtime state.

#### Scenario: Terminal task fields
- **WHEN** a terminal task is created with name "Start Dev Server" and command "npm run dev" in project P
- **THEN** the stored `TaskDef` has `kind: 'terminal'`, `command: 'npm run dev'`, no `prompt`, and `projectId` P

#### Scenario: Agent task fields
- **WHEN** an agent task is created with name "Triage bug" and a prompt in project P
- **THEN** the stored `TaskDef` has `kind: 'agent'`, the given `prompt`, no `command`, and `projectId` P

#### Scenario: Per-project keying
- **WHEN** tasks exist in projects P and Q
- **THEN** the persisted envelope lists each task only under its own project's key

#### Scenario: Runtime state not persisted
- **WHEN** the task store is serialized
- **THEN** no `paneId`, `running`, or `exitCode` field is written to disk

### Requirement: Task name derivation

When a task is created without an explicit name, the system SHALL derive a
default name from its command or prompt.

#### Scenario: Default name from command
- **WHEN** a terminal task is created with command "git push" and no name
- **THEN** the task's name defaults to a label derived from the command (e.g. "git push")

### Requirement: Task editing

The system SHALL allow editing an existing task's definition — its name, kind,
and command or prompt — and SHALL persist the change. Editing a running task
updates the stored definition (applied on its next run) without affecting the
current process.

#### Scenario: Edit a task definition
- **WHEN** a task's name and command are changed via an update
- **THEN** the stored definition reflects the new name and command and is persisted

### Requirement: Task persistence and migration

The system SHALL persist task definitions to `tasks.json` via Tauri
`tasks_load` / `tasks_save`, with save debounced and flushed on quit, and SHALL
fall back to an empty collection on parse error. On first load, if `tasks.json`
is absent but a legacy `terminals.json` exists, the system SHALL import each
legacy terminal as a `kind: 'terminal'` task and write `tasks.json`.

#### Scenario: Round-trip persistence
- **WHEN** tasks are created and the store is saved and reloaded
- **THEN** the same task definitions are restored

#### Scenario: Corrupt file falls back to empty
- **WHEN** `tasks.json` contains invalid JSON on load
- **THEN** the store loads an empty task collection without throwing

#### Scenario: Legacy terminals import
- **WHEN** `tasks.json` does not exist but `terminals.json` defines terminals
- **THEN** each legacy terminal is imported as a `kind: 'terminal'` task and `tasks.json` is written

### Requirement: Task lifecycle and runtime state

Each task SHALL be startable and stoppable. The store SHALL track per-task
runtime state (live `paneId`, running flag, exit code) that is not persisted.
Starting a stopped task SHALL allocate a fresh `paneId`.

#### Scenario: Start a task
- **WHEN** a stopped terminal task is started
- **THEN** its runtime is marked running with a fresh `paneId`

#### Scenario: Stop a running task
- **WHEN** a running task is stopped
- **THEN** its process is killed and its runtime is marked not running

#### Scenario: Restart allocates a fresh pane
- **WHEN** a task that previously ran is started again
- **THEN** a new `paneId` is allocated for the new run

### Requirement: Terminal task completion semantics

When a terminal-kind task's process exits, an exit code of 0 SHALL cause its
running pane to be auto-closed (removed from the running surface), and a non-zero
exit SHALL keep the pane open, mark the task failed, and expose a dismiss action
that removes the pane. A long-running terminal task that does not exit SHALL
remain running until explicitly stopped.

#### Scenario: Success auto-closes
- **WHEN** a terminal task's command exits with code 0
- **THEN** its running pane is removed automatically

#### Scenario: Error keeps pane open and marks failed
- **WHEN** a terminal task's command exits with a non-zero code
- **THEN** the pane stays open, the task is marked failed, and a dismiss action is available

#### Scenario: Dismiss a failed task
- **WHEN** the user dismisses a failed terminal task
- **THEN** its pane is removed and the failed state is cleared

#### Scenario: Long-runner persists
- **WHEN** a terminal task (e.g. a dev server) runs without exiting
- **THEN** its pane remains until the user stops it

### Requirement: Agent task launch

Starting an `agent`-kind task SHALL open a new Claude session in the main
workspace and Agents rail, seeded with the task's `prompt` as initial input, and
SHALL NOT create a pane in the right-docked running surface.

#### Scenario: Agent task opens a workspace session
- **WHEN** an agent task is started
- **THEN** a new Claude session appears in the workspace/Agents rail seeded with the task's prompt

#### Scenario: Agent task does not use the right panel
- **WHEN** an agent task is started
- **THEN** no terminal pane for it is added to the right-docked running surface

### Requirement: Bare interactive terminals are not tasks

The system SHALL allow launching a bare interactive shell (no command) that is
not a saved task definition. A bare terminal SHALL follow the same close-on-exit
rule as a terminal task: a clean exit (code 0) closes it (the slot is removed),
and a non-zero exit keeps it as a stopped slot so the error is readable.

#### Scenario: Bare shell launch
- **WHEN** the user launches a bare terminal with no command
- **THEN** an interactive shell runs and no `TaskDef` is created for it

#### Scenario: Bare shell closes on success
- **WHEN** a bare interactive shell exits with code 0
- **THEN** its slot is removed (the terminal closes)

#### Scenario: Bare shell stays open on error
- **WHEN** a bare interactive shell exits with a non-zero code
- **THEN** it remains as a stopped slot until dismissed
