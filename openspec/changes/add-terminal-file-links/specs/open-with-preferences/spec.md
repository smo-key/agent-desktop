## ADDED Requirements

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

When the app opens a file (a terminal ⌘-click or a transcript file link), it SHALL launch the application configured for the file's category. When that category is set to "System Default", the OS default handler SHALL be used instead.

#### Scenario: Configured application is used

- **WHEN** the code category is set to "Cursor" and a code file is opened
- **THEN** the file is launched in Cursor

#### Scenario: System Default falls back to the OS handler

- **WHEN** a file's category is set to "System Default"
- **THEN** the file is opened with the OS default handler (no specific application is forced)

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
