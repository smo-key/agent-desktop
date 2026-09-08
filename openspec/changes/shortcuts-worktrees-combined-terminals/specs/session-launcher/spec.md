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

The adopted directory SHALL be the worktree's ROOT, not whatever subdirectory the session currently stands in, and a pane SHALL be resolvable for adoption from ANY workspace rather than only the active one — otherwise a session left in a background tab is adopted late, with whatever directory it has since moved to. The snapshot SHALL report that root explicitly, since git's worktree name is an admin name that gains a counter suffix on a basename collision and is therefore not reliably a segment of the path; the adopted directory SHALL keep the path form the SESSION reports (the reported root supplies only the directory's name), because git canonicalizes symlinks while the session's own form is what Claude encodes into the project-directory name that locates its sidecars.

The adopted directory SHALL be persisted (unlike the worktree flag, which must never be re-applied) and SHALL be preferred over the launch directory wherever a pane's working directory is resolved: respawning it (restart, or archive → preview) SHALL land in the worktree, the transcript and subagent lookups SHALL use it — the subagent reader locates a session's sidecars purely by directory, so without this a worktree session lists no subagents — a split off that pane SHALL open in the worktree, and the orchestrator SHALL be told the worktree as that agent's directory. A pane SHALL FORGET an adopted directory that no longer exists (a worktree removed after its branch merged), falling back to the folder it was launched in, since nothing else could ever clear it and the pane would otherwise never spawn again.

#### Scenario: Snapshot reports the dir the session is in
- **WHEN** the statusline wrapper runs for a session inside a linked worktree, and for one in the main checkout
- **THEN** each snapshot reports that session's own directory alongside its worktree name

#### Scenario: A worktree session resumes in its worktree
- **WHEN** a pane launched with the worktree flag reports a linked-worktree directory that differs from its launch directory
- **THEN** that directory is adopted as the pane's working directory

#### Scenario: A worktree session adopts the reported worktree root
- **WHEN** the snapshot reports the worktree's root and a name that matches no segment of the path (git appended a counter)
- **THEN** the root is still adopted, falling back to deriving it from the name only for a snapshot that carries no root

#### Scenario: A worktree session keeps the path form the session reports
- **WHEN** the reported root is symlink-resolved but the session reports an unresolved path
- **THEN** the adopted directory is the session's own form, cut at the worktree directory's name

#### Scenario: A worktree session adopts the worktree root, not a subdirectory
- **WHEN** the session reports a directory nested inside its linked worktree
- **THEN** the worktree's root is adopted, and nothing is adopted when no path segment matches the worktree name

#### Scenario: A worktree pane is resolvable from any workspace
- **WHEN** the pane's workspace is not the active one
- **THEN** it still resolves to its real session (and its adopted worktree), rather than a fabricated login-shell default

#### Scenario: A pane forgets a worktree dir that no longer exists
- **WHEN** a restored pane's adopted worktree directory has been removed
- **THEN** the pane forgets it and falls back to the folder it was launched in

#### Scenario: A split inherits the focused pane worktree
- **WHEN** a pane is split off an agent that runs in a worktree
- **THEN** the new shell opens in that worktree

#### Scenario: A worktree session keeps its dir through archive and preview
- **WHEN** a pane with an adopted worktree directory is archived and then previewed
- **THEN** it still resolves to the worktree directory, while the worktree flag stays dropped

#### Scenario: An adopted worktree dir survives a restart
- **WHEN** a pane with an adopted worktree directory is serialized and restored
- **THEN** the restored pane keeps that directory (and still carries no worktree args)
