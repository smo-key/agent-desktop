## MODIFIED Requirements

### Requirement: Right-docked Terminals panel

While the terminals placement preference is the separate panel (the default), the right-docked panel SHALL be titled **Terminals** and SHALL host the running
panes of terminal-kind tasks and bare interactive terminals. It SHALL present a
blue `＋` button (matching the Agents bar style) that launches a new bare
interactive terminal. Existing behaviors — show/hide toggle (⌘J), running-count
badge, per-pane resize, and surviving project switches / panel hide without
killing processes — SHALL be preserved. In the combined placement the dock and its title-bar toggle SHALL be hidden and the toggle shortcut SHALL be inert, while the panel stays mounted so no terminal process is disturbed by switching placement.

#### Scenario: Titled Terminals with a new-terminal button
- **WHEN** the right-docked panel is shown
- **THEN** its title is "Terminals" and it has a `＋` button that opens a bare interactive terminal

#### Scenario: Hosts terminal task runs
- **WHEN** a terminal task is started
- **THEN** its running pane appears in the right-docked Terminals panel

#### Scenario: Toggle and badge preserved
- **WHEN** terminals are running and the user presses ⌘J
- **THEN** the panel toggles visibility and the running-count badge reflects the running terminals

#### Scenario: Processes survive hide and project switch
- **WHEN** the panel is hidden or the active project changes while a terminal runs
- **THEN** its process keeps running

#### Scenario: The dock and its toggle are hidden in combined placement
- **WHEN** the terminals placement is `combined`
- **THEN** the dock is not shown regardless of its toggle state, and it is shown in `panel` placement only while toggled open

## ADDED Requirements

### Requirement: Terminals can be combined into the sessions list

When the terminals placement is `combined`, every active terminal — a terminal-kind task with a runtime (running, failed, or kept open) and every bare shell — SHALL appear as a row in the sessions roster of its project, subject to the roster's project filter, with a status derived like an agent's (see agent-status-derivation). Selecting a terminal row SHALL show that terminal's live surface in the focus pane WITHOUT respawning it, with a header offering Restart (tasks) and Kill (running) / Close (stopped). The new-terminal shortcut SHALL still create a bare shell for the active project and select its row, and the cycle-focus shortcut SHALL step the selection across the agent and its project's terminal rows (a terminal is visible only as the selected row). Terminal rows are per-process and SHALL NOT be written into the persisted lane order or pinned list, and the Archived lane's "Delete all" SHALL neither count nor act on a stopped terminal row (closing it is the row's own Kill / Close action). A terminal row's timestamp is the terminal's start time, so date-ordered rosters do not re-sort on every output chunk.

#### Scenario: Combined placement lists terminals as rows
- **WHEN** a project has a running task terminal and a bare shell and the placement is `combined`
- **THEN** the roster contains a terminal row for each, carrying the project id, the terminal's name, and its live pane id

#### Scenario: Terminal rows follow the project filter
- **WHEN** the project filter selects project A while project B has terminals
- **THEN** only project A's terminal rows are listed

#### Scenario: Terminal row focus actions track its state
- **WHEN** a terminal row is focused
- **THEN** a running row offers Kill, a stopped row offers Close, and a task row additionally offers Restart

#### Scenario: Delete all archived leaves terminal rows alone
- **WHEN** the Archived lane holds an archived session and a stopped terminal row and the user confirms "Delete all"
- **THEN** only the archived session is deleted; the terminal row and its selection are untouched

#### Scenario: Terminal ids are never written to the persisted lane order
- **WHEN** terminal rows sit in the Needs-you or Paused lane order
- **THEN** the persisted order omits their ids, and an order that is unchanged after omitting them is not written again

#### Scenario: Selecting a terminal row shows its live terminal without respawn
- **WHEN** the user selects a terminal row
- **THEN** its existing terminal surface is shown in the focus pane and its process is not restarted

#### Scenario: New terminal shortcut adds and selects a row
- **WHEN** the user presses the new-terminal shortcut in combined placement
- **THEN** a bare shell row appears for the active project and becomes the focused row
