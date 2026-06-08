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
