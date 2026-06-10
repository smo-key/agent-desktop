## ADDED Requirements

### Requirement: Toggleable right-docked panel

The system SHALL provide a Terminals panel docked on the right edge of the main window that the user can toggle on and off via a title-bar control and a keyboard shortcut. When the panel is off it SHALL occupy no horizontal space and the agent grid SHALL fill the window as if the panel did not exist. When on, it SHALL be displayed as a fixed-position region to the right of the agent surface without altering the workspace tiling tree.

#### Scenario: Toggle the panel on

- **WHEN** the user activates the Terminals toggle (title-bar control or keyboard shortcut) while the panel is hidden
- **THEN** the panel appears docked on the right edge and the agent surface reflows to the remaining width

#### Scenario: Toggle the panel off reclaims space

- **WHEN** the user activates the Terminals toggle while the panel is shown
- **THEN** the panel is hidden and the agent surface expands to fill the full window width

#### Scenario: Panel state is independent of the workspace tree

- **WHEN** the panel is toggled on or off
- **THEN** the workspace tiling tree, agent focus, and workspace tabs are unchanged, and no agent pane is created, moved, or closed

### Requirement: Project-scoped visibility

The panel SHALL display the terminal collection belonging to the active project. The active project SHALL be resolved as follows, in priority order: (1) a concrete project explicitly selected in the overview's project filter; otherwise (2) the project of the currently focused agent pane. When focus moves to an agent in a different project (and no concrete project is selected in the filter), the panel SHALL swap to that project's terminal collection. When no concrete project is selected and the focused pane has no associated project (or no pane is focused), the panel SHALL show an empty state indicating no project is selected.

#### Scenario: Selected project is respected without a focused agent

- **WHEN** a concrete project is selected in the overview's project filter and no agent is focused (or the focused pane has no project)
- **THEN** the panel displays that selected project's terminal collection

#### Scenario: Selected project takes precedence over the focused agents project

- **WHEN** a concrete project is selected in the filter and the focused agent belongs to a different project
- **THEN** the panel displays the selected project's terminal collection

#### Scenario: Panel shows the focused project's terminals

- **WHEN** the focused agent pane belongs to project `web-app`
- **THEN** the panel displays the terminals in `web-app`'s collection and no other project's terminals

#### Scenario: Changing focus swaps the visible collection

- **WHEN** the user focuses an agent pane in project `api` while the panel was showing project `web-app`
- **THEN** the panel swaps to display `api`'s terminal collection

#### Scenario: No project shows an empty state

- **WHEN** the focused pane has no `projectId`, or no pane is focused
- **THEN** the panel shows an empty state prompting the user to focus an agent, and lists no terminals

#### Scenario: Swapping the collection does not change any process state

- **WHEN** the panel swaps from one project's collection to another's because focus changed
- **THEN** no terminal process is started, stopped, or restarted as a result of the swap

### Requirement: Resizable panel width

The panel's width SHALL be adjustable by dragging its inner edge, within sensible minimum and maximum bounds, and the chosen width SHALL persist across app restarts.

#### Scenario: Panel width is resizable within bounds

- **WHEN** the user sets the panel width (by dragging the edge)
- **THEN** the panel adopts that width, clamped to the allowed minimum and maximum

### Requirement: Terminal panel keyboard shortcuts

The system SHALL provide keyboard shortcuts to open a new terminal (⌘T — opens an empty shell in the active project) and to cycle keyboard focus across the active agent and its project's running terminals (⌘Tab, in order). The new-terminal shortcut SHALL open the panel if hidden.

#### Scenario: New terminal shortcut opens an empty shell

- **WHEN** the user presses ⌘T
- **THEN** the panel opens (if hidden) and a new empty shell terminal is created in the active project and focused

#### Scenario: Focus cycle shortcut moves between agent and terminals

- **WHEN** the user presses ⌘Tab
- **THEN** keyboard focus advances to the next target in the ring of the active agent followed by its project's running terminals

### Requirement: Vertical resizable stack of terminals

The panel SHALL arrange the active project's terminals as a vertical stack in which multiple terminals are visible simultaneously, and SHALL allow the user to resize the vertical share allocated to each terminal. Each terminal in the stack SHALL render a fully interactive terminal (keyboard input, output, resize reflow).

#### Scenario: Multiple terminals visible at once

- **WHEN** the active project has two or more terminals
- **THEN** all of them are shown stacked vertically within the panel at the same time

#### Scenario: Resizing a terminal's share

- **WHEN** the user drags the divider between two stacked terminals
- **THEN** the vertical space is reapportioned between them and each terminal reflows to its new size

#### Scenario: Terminal is interactive

- **WHEN** a terminal in the stack is focused and the user types
- **THEN** the keystrokes are delivered to that terminal's process and its output is rendered

### Requirement: Processes survive panel hide and project switch

Toggling the panel off, or switching the displayed project by changing focus, SHALL NOT terminate any terminal process. A running process (e.g. a web server) SHALL keep running while its panel is hidden or while another project's collection is displayed, and SHALL still be running and re-attached when the panel is shown again or its project is re-focused.

#### Scenario: Hiding the panel keeps a server running

- **WHEN** a terminal is running a web server and the user toggles the panel off
- **THEN** the server process continues running

#### Scenario: Re-showing the panel re-attaches to live processes

- **WHEN** the user toggles the panel back on after hiding it
- **THEN** the previously running terminals are shown still running with their live output, not re-spawned

#### Scenario: Switching projects keeps the other project's processes alive

- **WHEN** the panel swaps away from project `web-app` to project `api` because focus changed
- **THEN** `web-app`'s running terminals keep running and are shown running again when `web-app` is re-focused

### Requirement: Running-count indicator on the toggle

The Terminals toggle control SHALL indicate the number of currently running terminal processes so the user is aware of background processes even when the panel is hidden.

#### Scenario: Indicator reflects running processes while hidden

- **WHEN** two terminals are running and the panel is hidden
- **THEN** the toggle control shows an indicator conveying that two terminals are running

#### Scenario: Indicator clears when nothing runs

- **WHEN** no terminal processes are running
- **THEN** the toggle control shows no running-count indicator
