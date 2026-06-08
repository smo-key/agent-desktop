# project-tasks Specification

## Purpose
TBD - created by archiving change add-tasks-panel. Update Purpose after archive.
## Requirements
### Requirement: Task definition model

A task SHALL be a project-scoped definition with a stable `id`, a human-readable
`name`, a `projectId`, and a `kind` of either `terminal` or `agent`. A
`terminal` task SHALL carry a shell `command`; an `agent` task SHALL carry a
Claude `prompt`. Task definitions SHALL be persisted **per project**, in that
project's own `<project_path>/.agent-desktop/tasks.json` file as a flat envelope
`{ version, tasks: TaskDef[] }` (NOT in a single user-level file keyed by
`projectId`). The persisted file SHALL NOT serialize runtime state, and SHALL NOT
serialize the machine-local restore hints `wasRunning` or `lastCommand`.

#### Scenario: Terminal task fields
- **WHEN** a terminal task is created with name "Start Dev Server" and command "npm run dev" in project P
- **THEN** the stored `TaskDef` has `kind: 'terminal'`, `command: 'npm run dev'`, no `prompt`, and `projectId` P

#### Scenario: Agent task fields
- **WHEN** an agent task is created with name "Triage bug" and a prompt in project P
- **THEN** the stored `TaskDef` has `kind: 'agent'`, the given `prompt`, no `command`, and `projectId` P

#### Scenario: Per-project file
- **WHEN** project P at path `/repo` has tasks
- **THEN** they are persisted to `/repo/.agent-desktop/tasks.json` as `{ version, tasks: [...] }`, containing only P's tasks

#### Scenario: Runtime state not persisted
- **WHEN** the task store is serialized
- **THEN** no `paneId`, `running`, or `exitCode` field is written to disk, and no `wasRunning` or `lastCommand` field is written either

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

The system SHALL persist task definitions PER PROJECT to that project's
`<project_path>/.agent-desktop/tasks.json` via the Tauri `project_tasks_load` /
`project_tasks_save` commands, and SHALL fall back to an empty collection on a
missing or unparseable file. The system SHALL run a one-time migration of any
former user-level `tasks.json` (and the legacy `terminals.json` fallback) into
the per-project files, after which the user-level file is removed — the migration
behavior and its destructive cleanup are specified by the `project-folder-storage`
capability.

#### Scenario: Round-trip persistence
- **WHEN** tasks are created in project P and P's per-project file is saved and reloaded
- **THEN** the same task definitions are restored from `<P>/.agent-desktop/tasks.json`

#### Scenario: Corrupt file falls back to empty
- **WHEN** a project's `.agent-desktop/tasks.json` contains invalid JSON on load
- **THEN** that project loads an empty task collection without throwing

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

When a terminal-kind task's process exits, an exit code of 0 SHALL emit a success
notification carrying the task's name AND, unless the task has opted out via its
`closeOnComplete` flag, auto-close the running pane (remove it from the running
surface). A terminal with `closeOnComplete` set to `false` SHALL instead keep its
pane open on success as a stopped, non-failed slot (exit code 0) so its output
stays readable, while still emitting the success notification. A non-zero exit
SHALL always keep the pane open, mark the task failed, and expose a dismiss action
that removes the pane, regardless of `closeOnComplete`. The flag SHALL default to
"close" (its absence) and SHALL be persisted only when opted out (`false`). A
long-running terminal task that does not exit SHALL remain running until explicitly
stopped.

#### Scenario: Success auto-closes
- **WHEN** a terminal task with the default (close) option exits with code 0
- **THEN** its running pane is removed automatically

#### Scenario: Keep open on success when opted out
- **WHEN** a terminal task with `closeOnComplete` disabled exits with code 0
- **THEN** its pane stays open as a stopped, non-failed slot AND a completion notification is still emitted

#### Scenario: Close-on-complete choice persists
- **WHEN** a terminal task that opted out of auto-close is serialized and reloaded
- **THEN** its `closeOnComplete: false` choice round-trips (while a default task stores no flag)

#### Scenario: Successful task announces completion
- **WHEN** a terminal task's command exits with code 0
- **THEN** a completion notification carrying the task's name is emitted (and a non-zero exit emits none)

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
SHALL NOT create a pane in the right-docked running surface. Once that session
FINISHES the turn it was launched for and returns to the user (it is awaiting
input again after having started its turn), the system SHALL archive it
automatically.

#### Scenario: Agent task opens a workspace session
- **WHEN** an agent task is started
- **THEN** a new Claude session appears in the workspace/Agents rail seeded with the task's prompt

#### Scenario: Agent task does not use the right panel
- **WHEN** an agent task is started
- **THEN** no terminal pane for it is added to the right-docked running surface

#### Scenario: Agent task archives when it returns to the user
- **WHEN** a task-spawned agent session has started its turn (a prompt was submitted) and then returns to awaiting the user (status waiting/finished)
- **THEN** the session is archived automatically

### Requirement: Bare interactive terminals are not tasks

The system SHALL allow launching a bare interactive shell that is not a saved
task definition. A bare terminal SHALL follow the same close-on-exit rule as a
terminal task: a clean exit (code 0) closes it (the slot is removed), and a
non-zero exit keeps it as a stopped slot so the error is readable. A bare
terminal MAY be launched with an optional one-shot command that is typed and run
once after spawn (so a caller can open an interactive shell that has already run
a command, e.g. a failed `git push`); a blank/whitespace command leaves a plain
interactive shell.

#### Scenario: Bare shell launch
- **WHEN** the user launches a bare terminal with no command
- **THEN** an interactive shell runs and no `TaskDef` is created for it

#### Scenario: Bare shell closes on success
- **WHEN** a bare interactive shell exits with code 0
- **THEN** its slot is removed (the terminal closes)

#### Scenario: Bare shell stays open on error
- **WHEN** a bare interactive shell exits with a non-zero code
- **THEN** it remains as a stopped slot until dismissed

#### Scenario: Bare shell runs an initial command
- **WHEN** a bare terminal is launched with a non-blank command
- **THEN** the command is carried as the terminal's one-shot initial input (typed
  and run once after spawn) while the shell stays interactive
- **AND** a blank/whitespace command leaves a plain interactive shell with no
  initial input

