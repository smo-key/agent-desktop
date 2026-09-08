# project-folder-storage Specification

## Purpose

Per-project data (the user-created task definitions) is stored inside the
project's own folder under a committed `.agent-desktop/` directory, instead of at
the user level in the app-data directory. This makes the data travel with the
repo — shared across a team and portable across machines — and keyed by project
path rather than an opaque internal id. A one-time migration relocates any prior
user-level data into the project folders and then removes the user-level copies.

## Requirements

### Requirement: Project-folder storage directory

Per-project data SHALL be stored in a `.agent-desktop/` directory inside the
project's own folder (`<project_path>/.agent-desktop/`), committed with the repo
(NO `.gitignore` entry is added for it). The directory SHALL contain `tasks.json`
(the project's task definitions). The directory SHALL be created on first write
and is absent until then.

#### Scenario: Directory location
- **WHEN** project P at path `/repo` persists its tasks
- **THEN** the data is written under `/repo/.agent-desktop/` (creating it if absent)

#### Scenario: Not gitignored
- **WHEN** the `.agent-desktop/` directory is created for a project
- **THEN** no entry for `.agent-desktop` is added to the repo's `.gitignore`

### Requirement: Project tasks file format

The per-project `tasks.json` SHALL store a flat, single-project envelope
`{ version, tasks: TaskDef[] }` — the task definitions for THAT project only, with
no `projectId` keying (the file's location defines its project scope). A missing
or unparseable file SHALL be treated as an empty task list and SHALL NOT throw.

#### Scenario: Flat per-project envelope
- **WHEN** project P's tasks are serialized to `.agent-desktop/tasks.json`
- **THEN** the file is `{ version, tasks: [...] }` containing only P's task defs and no `projectId` field

#### Scenario: Missing file is empty
- **WHEN** `.agent-desktop/tasks.json` does not exist for project P
- **THEN** P loads with an empty task list and no error is raised

### Requirement: Path-keyed persistence commands

The backend SHALL expose commands to load and save a project's tasks by
**project path**: load returns the file's contents or `None` when the file
does not exist; save writes atomically (sibling temp file + rename) so a crash
mid-write never leaves a truncated file. A missing directory on load SHALL yield
`None` rather than an error.

#### Scenario: Load missing file
- **WHEN** `project_tasks_load` is invoked for a path with no `.agent-desktop/tasks.json`
- **THEN** it returns `None` (not an error)

#### Scenario: Atomic save
- **WHEN** `project_tasks_save` writes a file
- **THEN** the write goes to a sibling temp file then renames over the target, so readers always see a whole file

### Requirement: Sanitized committed task file

When writing `.agent-desktop/tasks.json`, the system SHALL exclude machine-local
restore hints — `wasRunning` and `lastCommand` — so the shared file never carries
one developer's transient session state. Definition fields (`id`, `name`, `kind`,
`command`, `cwd`, `prompt`, `closeOnComplete`) SHALL be retained.

#### Scenario: Restore hints stripped
- **WHEN** a project's tasks are serialized for `.agent-desktop/tasks.json` while some carried `wasRunning`/`lastCommand`
- **THEN** the written file contains no `wasRunning` or `lastCommand` field on any task

#### Scenario: Definition fields kept
- **WHEN** a task with a pinned `cwd` and `closeOnComplete: false` is written
- **THEN** the written file retains both `cwd` and `closeOnComplete`

### Requirement: Terminals restore as stopped slots

Because restore hints are no longer persisted, the system SHALL restore all
terminals as STOPPED slots on launch. No terminal SHALL be auto-started from
persisted state across an app quit/relaunch.

#### Scenario: No auto-restart after relaunch
- **WHEN** the app relaunches and loads a project's tasks
- **THEN** every terminal task is restored as a stopped slot and none is auto-started

### Requirement: Resilience to an unwritable project folder

The system SHALL operate tasks and config from in-memory state when a project's
folder is missing, read-only, or not yet present on disk, and SHALL retry the
write on the next save once the folder is writable. The system SHALL NOT fall
back to a user-level per-project file, and a failed write SHALL NOT throw or lose
in-memory state for the session.

#### Scenario: Write failure keeps in-memory state
- **WHEN** saving a project's tasks fails because its folder is not writable
- **THEN** the in-memory tasks are preserved and the error does not propagate as a crash

#### Scenario: Retry on next save
- **WHEN** a project's folder becomes writable and a subsequent save runs
- **THEN** the pending in-memory tasks are flushed to `.agent-desktop/tasks.json`

### Requirement: One-time migration from user-level storage

On the first run after this change, the system SHALL migrate existing user-level
task data into project folders and then remove the user-level copies. For each
project with user-level tasks (from `<app_data_dir>/tasks.json`, or the legacy
`terminals.json` fallback), it SHALL write the project's `.agent-desktop/tasks.json`
(sanitized). After all RESOLVABLE, writable projects are migrated, it SHALL delete
BOTH user-level source files — `tasks.json` AND the legacy `terminals.json`.
Clearing the legacy `terminals.json` is REQUIRED for idempotency: it is the
fallback source, so leaving it would re-fire the migration on every launch and
overwrite/resurrect per-project data. A project whose folder cannot be written
SHALL be skipped, leaving its user-level data intact for a later run. The
migration SHALL be idempotent — once both user-level source files are gone, it
reads null from both and does not run again.

#### Scenario: Tasks migrated to project folder
- **WHEN** the app first runs after this change with a user-level `tasks.json` holding tasks for project P (path writable)
- **THEN** P's tasks are written to `/P/.agent-desktop/tasks.json` (sanitized) and the user-level `tasks.json` is deleted afterward

#### Scenario: Unwritable project skipped
- **WHEN** project Q's folder is not writable during migration
- **THEN** Q's user-level tasks are left in place, the user-level `tasks.json` is NOT deleted, and migration retries Q on a later run

#### Scenario: Idempotent
- **WHEN** the app runs again after a successful migration
- **THEN** no migration occurs — both user-level `tasks.json` and the legacy `terminals.json` are gone, so each source reads null and no per-project file is rewritten

#### Scenario: Legacy source cleared
- **WHEN** a migration sourced tasks from the legacy `terminals.json` (because `tasks.json` was absent) and all writes succeeded
- **THEN** the legacy `terminals.json` is deleted, so the next launch does not re-migrate from it

#### Scenario: Does not clobber an existing per-project file
- **WHEN** migration runs and a project's `.agent-desktop/tasks.json` already exists (a prior run or committed data)
- **THEN** that file is left untouched (no overwrite) and the project still counts as migrated for cleanup purposes

#### Scenario: Corrupt registry preserves task data
- **WHEN** `projects.json` is unreadable/unparseable (no resolvable projects) while user-level tasks exist
- **THEN** no per-project file is written and NEITHER user-level source file is deleted (the data is preserved for a later run)
