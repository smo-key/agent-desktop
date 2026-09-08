## ADDED Requirements

### Requirement: Launch A Session In A New Git Worktree

The launcher SHALL offer a "Start in a new git worktree" option with an OPTIONAL worktree name. When chosen for a `claude` session, the first spawn SHALL pass `--worktree` (followed by the name when one was given) so Claude Code creates and enters the worktree itself; the pane's recorded cwd stays the project folder. The worktree flag is FIRST-SPAWN ONLY: it SHALL NOT be persisted with the pane, SHALL NOT be re-applied when the pane is restored with `--resume`, and SHALL be dropped when the session is archived so a later preview respawn resumes without it. A name beginning with `-` SHALL have the dashes stripped so it is never parsed as a flag. Backends without worktree support SHALL ignore the option. A global shortcut (default ⌘⇧N) SHALL open the launcher with the worktree option preset and the currently filtered project preselected, so a name can be entered before launch.

#### Scenario: Worktree launch passes the worktree flag
- **WHEN** a claude session is launched with the worktree option and no name
- **THEN** the plan's launch args are exactly `--worktree`

#### Scenario: Worktree launch with a name passes the name
- **WHEN** a claude session is launched with the worktree option and the name `feature-x`
- **THEN** the plan's launch args are `--worktree feature-x`

#### Scenario: Worktree flag is not re-applied on restore
- **WHEN** a pane launched with the worktree flag is serialized and restored
- **THEN** the restored pane carries no worktree args (it resumes with `--resume` only)

#### Scenario: Worktree flag is not re-applied when an archived session is previewed
- **WHEN** a session launched with the worktree flag is archived and then previewed (`--resume`)
- **THEN** its registry entry carries no worktree args and the respawn creates no worktree

#### Scenario: Worktree option is ignored for backends without worktree support
- **WHEN** a copilot session is launched with the worktree option
- **THEN** the plan's launch args are empty

#### Scenario: Shortcut opens the launcher with the worktree option preset
- **WHEN** the user presses the new-worktree-session shortcut
- **THEN** the launcher opens with "Start in a new git worktree" checked, the filtered project preselected, and the name field ready

### Requirement: A worktree session resumes in its worktree

The app SHALL adopt the working directory a `--worktree` session actually runs in, because Claude Code creates the worktree itself: the pane is spawned in the project folder and only the running session knows where it ended up. The statusline snapshot SHALL therefore report the session's current directory, and the pane SHALL adopt it as its working directory ONCE — only when that pane was launched with the worktree flag, the session reports it is inside a linked worktree, nothing has been adopted for it yet, and the reported directory differs from the launch directory — so a session that later changes directory never drags the pane's directory with it.

The adopted directory SHALL be persisted (unlike the worktree flag, which must never be re-applied) and SHALL be preferred over the launch directory wherever a pane's working directory is resolved: respawning it (restart, or archive → preview) SHALL land in the worktree, and the transcript and subagent lookups SHALL use it — the subagent reader locates a session's sidecars purely by directory, so without this a worktree session lists no subagents.

#### Scenario: Snapshot reports the dir the session is in
- **WHEN** the statusline wrapper runs for a session inside a linked worktree, and for one in the main checkout
- **THEN** each snapshot reports that session's own directory alongside its worktree name

#### Scenario: A worktree session resumes in its worktree
- **WHEN** a pane launched with the worktree flag reports a linked-worktree directory that differs from its launch directory
- **THEN** that directory is adopted as the pane's working directory

#### Scenario: A worktree session keeps its dir through archive and preview
- **WHEN** a pane with an adopted worktree directory is archived and then previewed
- **THEN** it still resolves to the worktree directory, while the worktree flag stays dropped

#### Scenario: An adopted worktree dir survives a restart
- **WHEN** a pane with an adopted worktree directory is serialized and restored
- **THEN** the restored pane keeps that directory (and still carries no worktree args)
