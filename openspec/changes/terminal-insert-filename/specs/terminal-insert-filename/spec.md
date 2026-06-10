## ADDED Requirements

### Requirement: Insert Filename context-menu action

The agent terminal pane's right-click context menu SHALL include an
**Insert Filename…** item in the same (first) section as Copy and Paste, showing a
⌘I shortcut hint. Choosing it SHALL open a native file picker. The item SHALL NOT be
disabled by selection state.

#### Scenario: Item present in the agent pane menu
- **WHEN** the user right-clicks an agent terminal pane
- **THEN** the context menu shows an "Insert Filename…" item with a ⌘I shortcut hint
  in the first section alongside Copy and Paste

#### Scenario: Choosing the item opens a file picker
- **WHEN** the user selects "Insert Filename…"
- **THEN** a native file-selection dialog opens (files only — folders are not
  selectable) at the OS default / last-used location

#### Scenario: Bare Terminals-panel shells are unaffected
- **WHEN** the user right-clicks a bare interactive terminal in the Terminals panel
- **THEN** no "Insert Filename…" action is offered (the feature is scoped to agent
  panes, which are the only panes with a pane context menu)

### Requirement: Insert Filename keyboard shortcut

Pressing **⌘I** SHALL perform the Insert Filename action against the currently
focused agent terminal, regardless of the active view and even while the terminal
has keyboard focus. The shortcut SHALL be a no-op (no dialog) when there is no live
focused agent terminal, and SHALL prevent the keystroke's default so no stray byte
reaches the PTY.

#### Scenario: ⌘I opens the picker for the focused terminal
- **WHEN** an agent terminal is focused and the user presses ⌘I
- **THEN** the same native file picker opens and a successful selection inserts into
  that focused terminal

#### Scenario: ⌘I with no live focused terminal
- **WHEN** the user presses ⌘I and there is no live focused agent terminal
- **THEN** nothing happens (no dialog opens) and the default keystroke is suppressed

#### Scenario: ⌘I is documented in the help modal
- **WHEN** the user opens the keyboard-shortcuts help modal
- **THEN** ⌘I is listed with a label describing inserting a file path into the
  terminal

### Requirement: Quoted absolute path inserted at the cursor

On a successful selection, the system SHALL insert the chosen file's absolute path,
wrapped in double quotes, into the focused agent terminal at its input cursor — using
the same PTY write path as Paste. Any double-quote character within the path SHALL be
escaped as `\"`. No trailing space SHALL be appended.

#### Scenario: Plain path is quoted and inserted
- **WHEN** the user selects the file `/Users/me/notes.txt`
- **THEN** the text `"/Users/me/notes.txt"` is written to the terminal at the cursor,
  with no trailing space

#### Scenario: Embedded double quote is escaped
- **WHEN** the selected path contains a `"` character (e.g. `/tmp/a"b.txt`)
- **THEN** the inserted text escapes it as `\"` inside the surrounding quotes
  (e.g. `"/tmp/a\"b.txt"`)

#### Scenario: Cancelling inserts nothing
- **WHEN** the user cancels the file dialog (or the dialog is unavailable)
- **THEN** nothing is written to the terminal
