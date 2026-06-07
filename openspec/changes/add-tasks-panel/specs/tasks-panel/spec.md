## ADDED Requirements

### Requirement: Tasks launcher panel

The system SHALL render a **Tasks** panel at the bottom of the left Agents
column, beneath the Agents rail, separated by a draggable splitter. The panel
SHALL default to roughly one third of the column height, SHALL be resizable via
the splitter, and SHALL persist its size. Its list UI SHALL mirror the Agents
rail and SHALL show the tasks of the currently active project.

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

### Requirement: Task launcher controls

The Tasks panel SHALL let the user create a task (`[+ Task]`), launch a bare
interactive terminal (`[⊳ Terminal]`), and start, stop, rename, and remove tasks
from the list. Creating a task SHALL allow choosing its kind (terminal command or
agent prompt). The list SHALL reflect each task's status (idle / running /
failed).

#### Scenario: Create a task
- **WHEN** the user activates `[+ Task]` and provides a name and a command or prompt
- **THEN** a new task of the chosen kind is added to the active project's list

#### Scenario: Launch a bare terminal from the panel
- **WHEN** the user activates `[⊳ Terminal]`
- **THEN** a bare interactive shell is launched (not saved as a task)

#### Scenario: Start and stop from the list
- **WHEN** the user starts then stops a task from the list
- **THEN** the task runs and then stops, and the list status updates accordingly

#### Scenario: Status reflects failure
- **WHEN** a terminal task fails
- **THEN** the task is shown as failed (red) in the list until dismissed

### Requirement: Right-docked Tasks panel

The right-docked panel previously titled "Terminals" SHALL be titled **Tasks**
and SHALL host the running panes of terminal-kind tasks. It SHALL NOT present a
`+` button for ad-hoc terminal creation. Existing behaviors — show/hide toggle
(⌘J), running-count badge, per-pane resize, and surviving project switches /
panel hide without killing processes — SHALL be preserved.

#### Scenario: Renamed, no plus button
- **WHEN** the right-docked panel is shown
- **THEN** its title is "Tasks" and it has no `+` add-terminal button

#### Scenario: Hosts terminal task runs
- **WHEN** a terminal task is started
- **THEN** its running pane appears in the right-docked Tasks panel

#### Scenario: Toggle and badge preserved
- **WHEN** terminal tasks are running and the user presses ⌘J
- **THEN** the panel toggles visibility and the running-count badge reflects the running tasks

#### Scenario: Processes survive hide and project switch
- **WHEN** the panel is hidden or the active project changes while a task runs
- **THEN** the task's process keeps running

### Requirement: Bare-terminal launch entry points

Because the right panel's `+` is removed, the system SHALL still allow launching
a bare interactive shell via the ⌘T keyboard shortcut and via the Tasks panel's
`[⊳ Terminal]` action.

#### Scenario: Keyboard shortcut
- **WHEN** the user presses ⌘T
- **THEN** a bare interactive shell is launched in the right-docked Tasks panel

#### Scenario: Footer action
- **WHEN** the user activates `[⊳ Terminal]` in the Tasks launcher
- **THEN** a bare interactive shell is launched
