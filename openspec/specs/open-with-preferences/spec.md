# open-with-preferences Specification

## Purpose
TBD - created by archiving change add-terminal-file-links. Update Purpose after archive.
## Requirements
### Requirement: Per-category open-with preferences

The app SHALL maintain a preference for which application opens a file, keyed by four categories: HTML files, Markdown files, code files, and other files (the catch-all, including directories and unknown/binary types). Each category's value SHALL be either "System Default" (the OS handler) or a named application. A file SHALL be classified into exactly one category by its filename/extension.

#### Scenario: HTML files classify to the HTML category

- **WHEN** a path ends in `.html`, `.htm`, or `.xhtml`
- **THEN** it is classified as an HTML file

#### Scenario: Markdown files classify to the Markdown category

- **WHEN** a path ends in `.md`, `.markdown`, `.mdx`, `.mdown`, or `.mkd`
- **THEN** it is classified as a Markdown file (its own category, not code)

#### Scenario: Source and text files classify to the code category

- **WHEN** a path is a recognized source or text file (e.g. `.ts`, `.py`, `.rs`, `.css`, `.txt`, or a well-known extension-less code file such as `Dockerfile`)
- **THEN** it is classified as a code file

#### Scenario: Unknown, binary, and extension-less paths classify to other

- **WHEN** a path has no recognized code/HTML extension (e.g. `.png`, `.zip`, a directory, or a dotfile)
- **THEN** it is classified as an other file

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

### Requirement: Preferences are editable in a Settings dialog

The app SHALL provide a Settings dialog, opened from a gear button in the top-right of the title bar, that lets the user choose the application for each category. Each category SHALL offer "System Default", a curated list of applications, and a custom application name. Changes SHALL take effect for subsequent opens without restarting the app.

#### Scenario: Opening the dialog

- **WHEN** the user clicks the title-bar settings (gear) button
- **THEN** the Settings dialog opens showing the current per-category preferences

#### Scenario: Choosing an application

- **WHEN** the user selects an application (or "System Default", or a custom name) for a category and closes the dialog
- **THEN** subsequent opens of files in that category use the new preference

#### Scenario: Dismissing the dialog

- **WHEN** the user presses Escape, clicks the backdrop, or clicks the close button
- **THEN** the dialog closes

### Requirement: Preferences persist across restarts

The preferences SHALL be persisted to disk and reloaded on startup so they survive app restarts. On a fresh install (no saved preferences) the app SHALL start with every category set to "System Default".

#### Scenario: Preference survives a restart

- **WHEN** the user sets a category's application and later relaunches the app
- **THEN** that category still maps to the chosen application

#### Scenario: Fresh install defaults to System Default

- **WHEN** the app starts with no saved preferences file
- **THEN** every category is "System Default" (the OS default handler is used until the user changes a category)

