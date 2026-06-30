## REMOVED Requirements

### Requirement: Project config file format

**Reason**: The `autoWorktree` setting was the only field in `config.json`, and
the auto-worktree feature is being removed. The per-project `config.json` envelope
and its load/save path are removed entirely.

**Migration**: No user action required. Any existing `.agent-desktop/config.json`
file is simply ignored and no longer read or written; it may be deleted by hand.

The per-project `config.json` SHALL store an additive envelope
`{ version, autoWorktree?: boolean }`. The `autoWorktree` setting SHALL be read
from and written to this file; it SHALL NOT be stored on the project record in
`projects.json`. A missing file or absent `autoWorktree` SHALL be treated as
`autoWorktree: false`.

#### Scenario: Auto-worktree read from config
- **WHEN** a session launches for project P whose `.agent-desktop/config.json` has `autoWorktree: true`
- **THEN** the launch path reads `autoWorktree` as `true` from the project-folder config

#### Scenario: Absent config defaults off
- **WHEN** project P has no `.agent-desktop/config.json` (or it lacks `autoWorktree`)
- **THEN** `autoWorktree` is treated as `false`

#### Scenario: Not stored in the registry
- **WHEN** project P's `autoWorktree` is enabled and saved
- **THEN** the value is persisted in `.agent-desktop/config.json` and the project's record in `projects.json` carries no `autoWorktree` field

## MODIFIED Requirements

### Requirement: Project-folder storage directory

Per-project data SHALL be stored in a `.agent-desktop/` directory inside the
project's own folder (`<project_path>/.agent-desktop/`), committed with the repo
(NO `.gitignore` entry is added for it). The directory SHALL contain
`tasks.json` (the project's task definitions). The directory SHALL be created on
first write and is absent until then.

#### Scenario: Directory location
- **WHEN** project P at path `/repo` persists its tasks
- **THEN** the data is written under `/repo/.agent-desktop/` (creating it if absent)

#### Scenario: Not gitignored
- **WHEN** the `.agent-desktop/` directory is created for a project
- **THEN** no entry for `.agent-desktop` is added to the repo's `.gitignore`

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
