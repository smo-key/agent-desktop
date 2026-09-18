# session-launcher Specification

## Purpose
TBD - created by archiving change add-agent-desktop. Update Purpose after archive.
## Requirements
### Requirement: Launch New Session With Folder Picker And Recents

The system SHALL provide a "new session" action that lets the user select a target project folder via a native folder picker or by choosing from a persisted recent-folders list before any session is spawned.

#### Scenario: Open the launcher and pick a folder via the native picker

- **WHEN** the user triggers the "new session" action and chooses "browse"
- **THEN** a native directory-selection dialog opens (Tauri dialog), and the absolute path of the chosen directory becomes the pending session's `cwd`

#### Scenario: Select a folder from the recent-folders list

- **WHEN** the launcher renders with one or more persisted recent folders
- **THEN** each recent folder is shown as a one-click selectable entry whose absolute path becomes the pending session's `cwd` without opening the native picker

#### Scenario: Cancelling the folder picker aborts the launch

- **WHEN** the user opens the native folder picker and cancels it without selecting a directory
- **THEN** no session is spawned, no PTY is created, and the recent-folders list is left unchanged

### Requirement: Optional Initial Prompt

The system SHALL let the user optionally enter an initial prompt that is delivered to the spawned `claude` session, and SHALL spawn the session normally when no prompt is provided.

#### Scenario: Launch with an initial prompt

- **WHEN** the user enters a non-empty initial prompt and confirms the launch
- **THEN** the spawned `claude` session receives that prompt as its first user input (e.g. written to the PTY after spawn) so it appears as the opening message of the session

#### Scenario: Launch with no initial prompt

- **WHEN** the user confirms the launch leaving the initial-prompt field empty
- **THEN** the session is spawned and `claude` starts at an idle interactive prompt awaiting user input, with no synthetic input injected

#### Scenario: Initial prompt is delivered only after the TUI is ready

- **WHEN** a session is launched with a non-empty initial prompt
- **THEN** the prompt is NOT written until the spawned `claude` has emitted its first PTY output and that output has then settled (the TUI is rendered and accepting input), so the prompt is never written into a terminal that has not started rendering
- **AND** a slow startup that stays silent past the settle window (e.g. a coordinated agent loading the orchestration toolkit) does NOT cause early delivery — the settle window only begins after the first output byte
- **AND** if output never settles, a hard-cap backstop delivers the prompt anyway so it never hangs

#### Scenario: A long initial prompt is delivered whole

- **WHEN** a session is launched into an agent pane with an initial prompt longer than the tty's input chunk size (e.g. a 1.4 KB agent-task prompt)
- **THEN** the prompt text is written to the PTY wrapped in bracketed-paste markers (`ESC[200~` … `ESC[201~`), with any embedded paste-end marker stripped, so the agent receives the ENTIRE prompt as its opening message rather than only its tail
- **AND** the submitting Enter is still delivered as a separate, later write

#### Scenario: Shell pane initial command is written raw

- **WHEN** a non-agent (shell) pane is launched with an initial command
- **THEN** the command is written verbatim with no bracketed-paste markers

### Requirement: Spawn Claude With Wrapper Override And Pane Env

The system SHALL spawn the resolved agent backend's program in the chosen
`cwd` with the `AGENT_DESKTOP_PANE` and `AGENT_DESKTOP_SNAPSHOT_DIR`
environment variables set. For a `claude` session, the statusline-wrapper
SHALL additionally be applied via a `--settings` override so the session joins
the usage dashboard through the statusline pipeline. For a backend that does
not declare statusline/hook support (e.g. `copilot`), the spawn SHALL pass
only that backend's declared launch arguments and SHALL NOT inject
Claude-specific `--settings`, hooks, or statusline configuration.

#### Scenario: Spawn carries the statusline override and pane env

- **WHEN** the launcher spawns a `claude` session for a chosen `cwd`
- **THEN** the `claude` process is launched with `--settings` set to inline JSON of the form `{"statusLine":{"type":"command","command":"<abs>/statusline-wrapper.js"}}` pointing at the app-support `bin/statusline-wrapper.js`
- **AND** the process environment includes a unique `AGENT_DESKTOP_PANE=<uuid>` matching the new pane's id and `AGENT_DESKTOP_SNAPSHOT_DIR` set to the app-support snapshots directory
- **AND** the process environment also seeds `TERM=xterm-256color`, `COLORTERM=truecolor`, plus inherited `PATH`/`HOME`/`LANG` so `claude` is discoverable under the sparse macOS GUI env

#### Scenario: Global settings are not mutated

- **WHEN** a session is spawned through the launcher
- **THEN** the user's global `~/.claude/settings.json` is left byte-identical and the override is applied only to the spawned session via the `--settings` flag

#### Scenario: Copilot spawn is minimal and clean

- **WHEN** the launcher spawns a `copilot` session for a chosen `cwd`
- **THEN** the process is launched with the Copilot backend's declared args (`--session-id <uuid>`, `--no-remote`) plus the same pane env (`AGENT_DESKTOP_PANE`, `AGENT_DESKTOP_SNAPSHOT_DIR`, terminal env seeding)
- **AND** no `--settings`, statusline, or hook configuration is injected, and the user's `~/.copilot` configuration is not mutated

### Requirement: Placement As New Tab Or Split Of Focused Pane

The system SHALL let the user choose whether the new session opens as a new workspace/tab (a fresh leaf) or by splitting the currently focused pane, and SHALL attach the spawned PTY to the resulting leaf.

#### Scenario: Open the session in a new tab

- **WHEN** the user selects the "new tab" placement and confirms the launch
- **THEN** a new workspace/tab containing a single leaf is created and the spawned PTY is attached to that leaf, which becomes focused

#### Scenario: Open the session by splitting the focused pane

- **WHEN** the user selects the "split focused" placement and confirms the launch
- **THEN** the currently focused leaf is replaced by a split containing the original leaf plus a new leaf, and the spawned PTY is attached to the new leaf without remounting the existing focused pane's terminal

#### Scenario: Split placement is unavailable with no focused pane

- **WHEN** the user opens the launcher while no pane is focused (empty workspace)
- **THEN** the "split focused" placement is disabled or absent and the session opens as a new tab instead

### Requirement: Recent-Folders Persistence Across Restarts

The system SHALL persist the recent-folders list to app-support storage and reload it on startup, recording each successfully launched folder as most-recent and de-duplicating repeats.

#### Scenario: A launched folder is added to recents

- **WHEN** a session is successfully spawned for a `cwd` not already at the top of the recent-folders list
- **THEN** that absolute path is written to the persisted recent-folders store as the most-recent entry

#### Scenario: Recents survive an app restart

- **WHEN** the app is quit and relaunched after a session was launched in a folder
- **THEN** the launcher's recent-folders list is reloaded from app-support storage and still contains that folder

#### Scenario: Re-launching an existing folder does not duplicate it

- **WHEN** the user launches a session in a folder that is already present in the recent-folders list
- **THEN** the folder is moved to the most-recent position rather than added as a second entry, so no duplicate paths exist in the list

### Requirement: No Auto-Run Of Slash Commands

The system SHALL NOT auto-run any `/workflow:*` or other slash commands when launching a session, leaving all slash-command invocation to the user.

#### Scenario: No slash command is injected on launch

- **WHEN** any session is spawned through the launcher, with or without an initial prompt
- **THEN** no `/workflow:*` command and no other slash command is written to the PTY or passed as an argument by the launcher, and the only input the session receives is the user's verbatim initial prompt (if any)

#### Scenario: Initial prompt beginning with a slash is passed through verbatim

- **WHEN** the user's optional initial prompt itself begins with `/`
- **THEN** the launcher delivers that text verbatim as user input without expanding, intercepting, or executing it as an app-driven command

### Requirement: Launcher Agent Selection
The launcher SHALL show which agent backend the session will use, seeded from
the global agent setting, and SHALL let the user override it for the pending
session only. The launch plan SHALL carry the resolved agent kind instead of a
hard-coded program, and startup readiness timing (quiet window, hard cap,
submit delay) for initial-prompt delivery SHALL come from the resolved
backend's descriptor.

#### Scenario: Launcher seeds from the global setting
- **WHEN** the launcher opens while the global agent setting is Copilot
- **THEN** the agent selector shows Copilot and launching spawns `copilot`

#### Scenario: One-off override does not change the default
- **WHEN** the user overrides the launcher's agent to Claude for one launch
- **THEN** that session spawns `claude` and the next launcher open still seeds from the unchanged global setting

#### Scenario: Initial prompt uses backend timing
- **WHEN** a session launches with an initial prompt
- **THEN** prompt delivery waits for the spawned backend's declared startup-quiet window (falling back to its hard cap), not Claude-calibrated constants baked into the launcher

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

