# terminal-file-links Specification (delta)

## MODIFIED Requirements

### Requirement: Open on ⌘-click via open-with preferences

When the user ⌘-clicks a linkified token, the terminal SHALL open the resolved absolute path according to the user's open-with preferences (see the `open-with-preferences` capability): the file's category selects an application, or the OS default handler when the category is set to system. The terminal SHALL pass the pane's working directory as the workspace root for this open, subject to the open-with capability's project-aware-editor gating, so that a project-aware editor opens the project and reveals the file. The ⌘-click SHALL NOT be delivered to the terminal process (no selection, no mouse-report escape sequence). A failure to launch SHALL NOT block or crash the UI.

#### Scenario: ⌘-click opens a file via its category preference

- **WHEN** the user ⌘-clicks a linkified file path whose category is configured to a specific application
- **THEN** the file is opened in that application

#### Scenario: ⌘-click opens the project workspace in a project-aware editor

- **WHEN** the user ⌘-clicks a linkified path in a pane whose working directory is known and the file's category is a project-aware editor
- **THEN** the editor opens with that working directory as the workspace root and the file revealed within it

#### Scenario: ⌘-click uses the OS default when the category is system

- **WHEN** the user ⌘-clicks a linkified path whose category preference is "System Default"
- **THEN** the path is opened with the OS default handler (a directory in the system file browser, a file in its registered default app) and no workspace root is passed

#### Scenario: ⌘-click is not sent to the terminal process

- **WHEN** the user ⌘-clicks a linkified path
- **THEN** no text selection begins and no mouse event is reported to the running program

#### Scenario: Launch failure is non-fatal

- **WHEN** opening the resolved path fails
- **THEN** the error is handled silently (logged/ignored) and the terminal remains responsive
