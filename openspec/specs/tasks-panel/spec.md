# tasks-panel Specification

## Purpose
TBD - created by archiving change add-tasks-panel. Update Purpose after archive.
## Requirements

### Requirement: Tasks launcher panel

The system SHALL render a **Tasks** panel at the bottom of the left Agents
column, beneath the Agents rail, separated by a draggable splitter. The panel
SHALL default to roughly one third of the column height, SHALL be resizable via
the splitter, and SHALL persist its size. Its list UI SHALL mirror the Agents
rail and SHALL show the tasks of the currently active project. The panel header
SHALL match the Agents bar's style — a title "Tasks", a count, and a blue `＋`
launch button (the same control treatment as the Agents roster header).

#### Scenario: Panel position and default size
- **WHEN** the app renders the left column
- **THEN** a "Tasks" panel appears below the Agents rail at ~1/3 height with a splitter between them

#### Scenario: Resizable splitter
- **WHEN** the user drags the splitter between the Agents rail and the Tasks panel
- **THEN** the Tasks panel resizes and the new size persists across reloads

#### Scenario: Active-project scoping
- **WHEN** the focused pane belongs to project P
- **THEN** the Tasks panel lists project P's tasks

#### Scenario: Empty and no-project states
- **WHEN** the active project has no tasks, or no project is active
- **THEN** the panel shows an appropriate empty / no-project state

#### Scenario: Header matches the Agents bar
- **WHEN** the Tasks panel header renders
- **THEN** its title and `＋` launch button use the same styling as the Agents roster header

### Requirement: Task launcher controls

The Tasks panel SHALL let the user create a task (the header `＋`). **Clicking a
task row** in the list SHALL start it (a running task's row instead reveals the
Terminals panel). A **right-click context menu** on a row SHALL offer Edit and
Delete (and, contextually, Stop for a running task or Dismiss for a failed one).
Creating and editing SHALL happen in a dialog (not inline). The list SHALL
reflect each task's status (idle / running / failed). Deleting a task SHALL
require explicit confirmation.

#### Scenario: Create a task via the dialog
- **WHEN** the user activates the header `＋`
- **THEN** the create-task dialog opens, and on submit a new task of the chosen kind is added to the active project's list

#### Scenario: Clicking a task starts it
- **WHEN** the user clicks a non-running task's row
- **THEN** the task starts (a terminal task's pane opens in the Terminals panel; an agent task opens a Claude session)

#### Scenario: Edit or delete via context menu
- **WHEN** the user right-clicks a task row
- **THEN** a context menu offers Edit and Delete (and Stop / Dismiss when applicable)

#### Scenario: Edit a task via the dialog
- **WHEN** the user edits an existing task
- **THEN** the dialog opens pre-filled with the task's fields and saving updates the task definition

#### Scenario: Delete requires confirmation
- **WHEN** the user deletes a task
- **THEN** a confirmation is required, and the task is removed only after the user confirms

#### Scenario: Start and stop from the list
- **WHEN** the user starts then stops a task from the list
- **THEN** the task runs and then stops, and the list status updates accordingly

#### Scenario: Status reflects failure
- **WHEN** a terminal task fails
- **THEN** the task is shown as failed (red) in the list until dismissed

### Requirement: Create/edit task dialog

The system SHALL provide a modal dialog, modeled on the New session dialog, to
create or edit a task. The task name SHALL be OPTIONAL — when left blank the
system derives a default from the command or prompt. For a terminal task the
command input SHALL use a monospace font, and the dialog SHALL present a "Close
automatically when complete" checkbox (defaulting to checked) that sets the task's
`closeOnComplete` behavior. The checkbox SHALL be shown only for terminal-kind
tasks. The dialog SHALL be dismissable (Cancel / Escape / backdrop) without
changing any task.

#### Scenario: Dialog mimics the New session modal
- **WHEN** the create/edit dialog opens
- **THEN** it presents as a centered modal with a backdrop, kind selector, name and command/prompt fields, and Cancel / primary actions, like the New session dialog

#### Scenario: Name is optional
- **WHEN** a task is submitted with an empty name
- **THEN** the task is created with a name derived from its command or prompt

#### Scenario: Command field is monospace
- **WHEN** a terminal task's command field is shown in the dialog
- **THEN** its text is rendered in a monospace font

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

### Requirement: Task and terminal launch shortcuts

The system SHALL open the create-task dialog via ⌘T, and SHALL launch a new bare
interactive terminal via ⌘Y and via the Terminals panel's `＋` button.

#### Scenario: Cmd T opens the task dialog
- **WHEN** the user presses ⌘T
- **THEN** the create-task dialog opens for the active project

#### Scenario: Keyboard shortcut opens a bare terminal
- **WHEN** the user presses ⌘Y
- **THEN** a bare interactive terminal is launched in the right-docked Terminals panel

#### Scenario: New terminal button
- **WHEN** the user activates the Terminals panel's `＋` button
- **THEN** a bare interactive terminal is launched

### Requirement: Task completion toast

When a terminal task completes successfully, the system SHALL show a transient
toast notification reading "<task name> completed", anchored to the bottom-left of
the window. The toast fires on a successful exit regardless of the task's
`closeOnComplete` setting (whether or not the pane auto-closes).

#### Scenario: Completion toast on success
- **WHEN** a terminal task's command exits with code 0
- **THEN** a toast reading "<task name> completed" appears briefly and auto-dismisses

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

### Requirement: Terminal rows are titled like sessions

A terminal row in the combined sessions list SHALL be renameable exactly like a session row: the focus-pane header title is an inline edit and the row's context menu offers **Rename**, both committing a CUSTOM title that is sticky (never re-generated) and shown in place of the terminal's name. The durable title key SHALL be the terminal's task id (`task:<defId>`), which survives a restart of that task; a bare shell's key is per-process and its custom title SHALL therefore live only for that process, matching the rule that terminal ids are never persisted. Renaming a terminal row SHALL NOT rename the underlying task definition, which keeps its name in the Tasks launcher.

#### Scenario: A task terminal row carries a durable title key
- **WHEN** the title key of a task terminal row and of a bare shell row is resolved
- **THEN** the task row's key is its `task:<defId>` and the bare shell's key is null, so only the task title is persisted

#### Scenario: A renamed terminal row keeps its custom title
- **WHEN** a terminal row is renamed and a title generation for it later resolves
- **THEN** the custom title is kept and the generated one is discarded

#### Scenario: Renaming a row to its current name pins that name
- **WHEN** the user presses Enter on a rename whose text equals the name already shown
- **THEN** the name becomes the row's custom title, so the generator never replaces it

#### Scenario: Opening the rename editor and clicking away changes nothing
- **WHEN** the rename editor loses focus with its text untouched, even after the row's title changed while it was open
- **THEN** no custom title is written and the row keeps generating its title

#### Scenario: A rename in progress holds the focus
- **WHEN** another session starts needing attention while a rename editor is open
- **THEN** focus does not auto-advance and roster navigation is inert, so the typed name is not discarded — but a focused row that disappears, or whose header stops offering an editor, still hands focus on and abandons the edit

#### Scenario: A restarted task terminal recovers its custom title
- **WHEN** a task terminal with a custom title is restarted under a new pane id
- **THEN** hydrating the new pane from the durable cache restores the custom title with no model call

#### Scenario: Renaming a terminal row from the header or its menu
- **WHEN** the user clicks the focused terminal's header title or picks Rename in its row menu
- **THEN** an inline edit opens, and committing it shows the custom title on the row and header
