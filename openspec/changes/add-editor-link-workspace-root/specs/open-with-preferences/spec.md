# open-with-preferences Specification (delta)

## MODIFIED Requirements

### Requirement: Opening a file honors its category preference

When the app opens a file (a terminal ⌘-click or a transcript file link), it SHALL launch the application configured for the file's category, and when that category is set to "System Default" it SHALL use the OS default handler instead. When the resolved application is a project-aware editor (Cursor, Visual Studio Code, Zed, or Sublime Text) AND a known working directory contains the file, the app SHALL additionally pass that working directory to the editor as a workspace root, so the editor opens the project and reveals the file. The app SHALL NOT pass a workspace root when the category is "System Default", when the resolved application is not a project-aware editor (e.g. TextEdit, Finder, or a custom application name), when no working directory is known, or when the known working directory does not contain the file — in those cases only the file is opened, exactly as before.

#### Scenario: Configured application is used

- **WHEN** the code category is set to "Cursor" and a code file is opened
- **THEN** the file is launched in Cursor

#### Scenario: System Default falls back to the OS handler

- **WHEN** a file's category is set to "System Default"
- **THEN** the file is opened with the OS default handler (no specific application is forced)

#### Scenario: Project-aware editor opens the project as a workspace

- **WHEN** the code category is set to a project-aware editor (e.g. "Cursor"), a working directory is known, and a file within it is opened
- **THEN** the editor is launched with that working directory as the workspace root AND the file, so the project opens and the file is revealed inside it

#### Scenario: System Default never receives a workspace root

- **WHEN** a file's category is "System Default" and a working directory is known
- **THEN** only the file is opened with the OS default handler; the working directory is not passed, so no file browser is opened on the folder

#### Scenario: Non-project-aware application receives only the file

- **WHEN** the resolved application is one that cannot take a folder-as-workspace argument (e.g. "TextEdit", "Finder", or a custom application name), even if a working directory is known
- **THEN** only the file is opened in that application and no workspace root is passed

#### Scenario: No known working directory falls back to file-only

- **WHEN** a file is opened in a project-aware editor but no working directory is known for it
- **THEN** only the file is opened (no workspace root is passed), preserving the prior behavior

#### Scenario: A working directory that does not contain the file falls back to file-only

- **WHEN** a file is opened in a project-aware editor with a known working directory, but the resolved file lives outside that directory (e.g. an absolute path clicked outside the project, or a non-file target such as a URL)
- **THEN** the working directory is not passed and only the file is opened, so no unrelated project is opened as a workspace
