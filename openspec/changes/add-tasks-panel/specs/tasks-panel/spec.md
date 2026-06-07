## ADDED Requirements

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
command input SHALL use a monospace font. The dialog SHALL be dismissable
(Cancel / Escape / backdrop) without changing any task.

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

The right-docked panel SHALL be titled **Terminals** and SHALL host the running
panes of terminal-kind tasks and bare interactive terminals. It SHALL present a
blue `＋` button (matching the Agents bar style) that launches a new bare
interactive terminal. Existing behaviors — show/hide toggle (⌘J), running-count
badge, per-pane resize, and surviving project switches / panel hide without
killing processes — SHALL be preserved.

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
