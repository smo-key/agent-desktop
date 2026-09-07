## ADDED Requirements

### Requirement: Launch A Session In A New Git Worktree

The launcher SHALL offer a "Start in a new git worktree" option with an OPTIONAL worktree name. When chosen for a `claude` session, the first spawn SHALL pass `--worktree` (followed by the name when one was given) so Claude Code creates and enters the worktree itself; the pane's recorded cwd stays the project folder. The worktree flag is LAUNCH-TIME ONLY: it SHALL NOT be persisted with the pane and SHALL NOT be re-applied when the pane is restored with `--resume`. Backends without worktree support SHALL ignore the option. A global shortcut (default ⌘⇧N) SHALL open the launcher with the worktree option preset and the currently filtered project preselected, so a name can be entered before launch.

#### Scenario: Worktree launch passes the worktree flag
- **WHEN** a claude session is launched with the worktree option and no name
- **THEN** the plan's launch args are exactly `--worktree`

#### Scenario: Worktree launch with a name passes the name
- **WHEN** a claude session is launched with the worktree option and the name `feature-x`
- **THEN** the plan's launch args are `--worktree feature-x`

#### Scenario: Worktree flag is not re-applied on restore
- **WHEN** a pane launched with the worktree flag is serialized and restored
- **THEN** the restored pane carries no worktree args (it resumes with `--resume` only)

#### Scenario: Worktree option is ignored for backends without worktree support
- **WHEN** a copilot session is launched with the worktree option
- **THEN** the plan's launch args are empty

#### Scenario: Shortcut opens the launcher with the worktree option preset
- **WHEN** the user presses the new-worktree-session shortcut
- **THEN** the launcher opens with "Start in a new git worktree" checked, the filtered project preselected, and the name field ready
