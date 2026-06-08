## MODIFIED Requirements

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
