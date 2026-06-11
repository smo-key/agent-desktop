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

### Requirement: Spawn Claude With Wrapper Override And Pane Env

The system SHALL spawn `claude` in the chosen `cwd` with the statusline-wrapper applied via a `--settings` override and the `AGENT_DESKTOP_PANE` and `AGENT_DESKTOP_SNAPSHOT_DIR` environment variables set, so the session joins the usage dashboard.

#### Scenario: Spawn carries the statusline override and pane env

- **WHEN** the launcher spawns a session for a chosen `cwd`
- **THEN** the `claude` process is launched with `--settings` set to inline JSON of the form `{"statusLine":{"type":"command","command":"<abs>/statusline-wrapper.js"}}` pointing at the app-support `bin/statusline-wrapper.js`
- **AND** the process environment includes a unique `AGENT_DESKTOP_PANE=<uuid>` matching the new pane's id and `AGENT_DESKTOP_SNAPSHOT_DIR` set to the app-support snapshots directory
- **AND** the process environment also seeds `TERM=xterm-256color`, `COLORTERM=truecolor`, plus inherited `PATH`/`HOME`/`LANG` so `claude` is discoverable under the sparse macOS GUI env

#### Scenario: Global settings are not mutated

- **WHEN** a session is spawned through the launcher
- **THEN** the user's global `~/.claude/settings.json` is left byte-identical and the override is applied only to the spawned session via the `--settings` flag

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

