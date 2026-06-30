## REMOVED Requirements

### Requirement: Per-project auto-worktree setting

**Reason**: The auto-worktree opt-in is being removed; projects no longer carry
an `autoWorktree` setting and the create/edit form no longer exposes a toggle.

**Migration**: No user action required. Any `autoWorktree` value left in a
project's folder config or `projects.json` record becomes inert and is ignored.
Users who want a per-session worktree can create one manually from the worktree
management view (see "Manage a project's worktrees").

A project SHALL have an optional `autoWorktree` boolean setting that, when absent,
defaults to `false`. The setting SHALL be persisted in the project's own folder
config at `<project>/.agent-desktop/config.json` (the project-folder-storage
capability), NOT on the `Project` record in `projects.json`; it SHALL survive
reload and restart. Reading the setting MUST be robust: an absent, malformed, or
unreadable folder config resolves to `autoWorktree: false` and never throws.

The project create/edit form SHALL expose a control to view and change
`autoWorktree`. In edit mode the control SHALL be seeded from the project's folder
config. Saving the form SHALL persist the chosen value to the project's folder
config.

#### Scenario: Toggling the setting persists it

- **WHEN** the user enables auto-worktree in a project's edit form and saves
- **THEN** `autoWorktree: true` is written to the project's
  `<project>/.agent-desktop/config.json`
- **AND** reopening the form seeds the control from that folder config in the
  enabled state

#### Scenario: Existing projects default to off

- **WHEN** a project has no folder config (or it is absent/malformed/unreadable)
- **THEN** its `autoWorktree` resolves to `false`
- **AND** launching a session for it uses the project path with no worktree

### Requirement: Auto-create a worktree on session launch

**Reason**: Launching a session no longer creates a worktree automatically; the
session always runs in the project path.

**Migration**: None. Worktree creation is now only available manually via the
worktree management view.

The system SHALL, when a session is launched for a project whose `autoWorktree`
is `true`, create a new git worktree for that session and run the session in the
worktree directory instead of the project path. The worktree SHALL be created
under `<repo>/.worktrees/` on a NEW branch named `session/<timestamp>-<id>` that is
unique per launch, branched from the repository's current `HEAD`. The commit the
branch is created from (the base SHA) SHALL be recorded for the session so later
cleanup can be evaluated deterministically.

The first time a worktree is created for a repository, the system SHALL ensure the
repository's root `.gitignore` ignores `.worktrees`, appending an entry if one is
not already present. This operation SHALL be idempotent (no duplicate entries on
subsequent creations).

#### Scenario: Launching an auto-worktree project

- **WHEN** the user launches a session for a project with `autoWorktree` enabled
  that points at a valid git repository
- **THEN** a new worktree is created under `<repo>/.worktrees/session/<timestamp>-<id>`
  on a new branch off the current `HEAD`
- **AND** the session runs with that worktree path as its working directory

#### Scenario: First worktree updates .gitignore

- **WHEN** the first worktree is created for a repository whose `.gitignore` does
  not already ignore `.worktrees`
- **THEN** a `.worktrees` entry is appended to the repository's `.gitignore`
- **AND** creating a further worktree for the same repository adds no duplicate entry

#### Scenario: Concurrent launches get distinct worktrees

- **WHEN** two sessions are launched in quick succession for the same enabled project
- **THEN** each session gets its own worktree directory and its own unique branch
- **AND** neither launch reuses or collides with the other's worktree

### Requirement: Fallback when worktree creation fails

**Reason**: Removed together with launch-time auto-creation; there is no
auto-create path left to fall back from.

**Migration**: None.

The system SHALL still launch the session in the project's normal path, and SHALL
surface a non-blocking warning, if creating the worktree fails for any reason —
for example the project folder is not a git repository, or git returns an error. A
worktree failure MUST NOT prevent the session from starting.

#### Scenario: Project folder is not a git repository

- **WHEN** the user launches a session for an enabled project whose folder is not a
  git repository
- **THEN** the session launches in the project's normal path
- **AND** a non-blocking warning informs the user that the worktree could not be created

#### Scenario: Git error during creation

- **WHEN** worktree creation fails due to a git error
- **THEN** the session still starts in the project path
- **AND** the failure does not block or abort the launch

### Requirement: Conditional cleanup on session close

**Reason**: With no auto-created worktrees, there is nothing to clean up on close.
Manual worktrees are removed only through explicit pruning in the management view.

**Migration**: Worktrees created manually persist until the user prunes them from
the worktree management view; closing a session never removes a worktree.

The system SHALL, when a session running in an auto-created worktree is
permanently closed (its pane removed and its process terminated), remove that
session's worktree ONLY IF the worktree is clean — meaning it has no uncommitted
changes AND no commits added beyond its recorded base SHA. When the worktree is
clean and removed, its session branch SHALL also be deleted. If the worktree is
not clean, the system SHALL keep both the worktree and its branch so that
unsaved or uncommitted work is never destroyed.

Archiving a session (which leaves it resumable) SHALL NOT remove its worktree;
only permanent close triggers cleanup. Cleanup SHALL be best-effort and MUST NOT
block session teardown.

#### Scenario: Clean worktree is removed on close

- **WHEN** a session whose worktree has no uncommitted changes and no new commits is
  permanently closed
- **THEN** the worktree directory is removed
- **AND** its session branch is deleted

#### Scenario: Dirty worktree is kept on close

- **WHEN** a session whose worktree has uncommitted changes or commits beyond its
  base is permanently closed
- **THEN** the worktree and its branch are left in place
- **AND** no work is destroyed

#### Scenario: Archiving does not remove the worktree

- **WHEN** a session running in a worktree is archived (kept resumable) rather than
  permanently closed
- **THEN** its worktree is preserved so the session can be resumed later
