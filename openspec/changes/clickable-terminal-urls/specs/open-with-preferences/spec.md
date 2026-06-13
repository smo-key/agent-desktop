# open-with-preferences delta

## MODIFIED Requirements

### Requirement: Per-category open-with preferences

The app SHALL maintain a preference for which application opens a target, keyed by
four categories: HTML files (and `http(s)` URLs), Markdown files, code files, and
other files (the catch-all, including directories and unknown/binary types). Each
category's value SHALL be either "System Default" (the OS handler) or a named
application. A file SHALL be classified into exactly one category by its
filename/extension. An `http://` or `https://` URL SHALL classify to the HTML
category by its scheme, taking precedence over any extension in the URL path (so a
URL ending in e.g. `.css` still classifies as HTML, not code).

#### Scenario: HTML files classify to the HTML category

- **WHEN** a path ends in `.html`, `.htm`, or `.xhtml`
- **THEN** it is classified as an HTML file

#### Scenario: HTTP/HTTPS URLs classify to the HTML category

- **WHEN** the target is an `http://` or `https://` URL (e.g. `https://example.com/docs` or `http://localhost:3000`)
- **THEN** it is classified into the HTML category, regardless of any extension in its path, so it opens with the HTML category's application (or the OS default)

#### Scenario: Markdown files classify to the Markdown category

- **WHEN** a path ends in `.md`, `.markdown`, `.mdx`, `.mdown`, or `.mkd`
- **THEN** it is classified as a Markdown file (its own category, not code)

#### Scenario: Source and text files classify to the code category

- **WHEN** a path is a recognized source or text file (e.g. `.ts`, `.py`, `.rs`, `.css`, `.txt`, or a well-known extension-less code file such as `Dockerfile`)
- **THEN** it is classified as a code file

#### Scenario: Unknown, binary, and extension-less paths classify to other

- **WHEN** a path has no recognized code/HTML extension (e.g. `.png`, `.zip`, a directory, or a dotfile)
- **THEN** it is classified as an other file

### Requirement: Preferences are editable in a Settings dialog

The app SHALL provide a Settings dialog, opened from a gear button in the top-right of the title bar, that lets the user choose the application for each category. Each category SHALL offer "System Default", a curated list of applications, and a custom application name. Changes SHALL take effect for subsequent opens without restarting the app. The HTML category SHALL be labeled to make clear it also governs URLs (e.g. "HTML files and URLs").

#### Scenario: Opening the dialog

- **WHEN** the user clicks the title-bar settings (gear) button
- **THEN** the Settings dialog opens showing the current per-category preferences

#### Scenario: The HTML category is labeled for files and URLs

- **WHEN** the Settings dialog is open
- **THEN** the HTML category row is labeled "HTML files and URLs", reflecting that the choice governs both `.html`-family files and `http(s)` URLs

#### Scenario: Choosing an application

- **WHEN** the user selects an application (or "System Default", or a custom name) for a category and closes the dialog
- **THEN** subsequent opens of files in that category use the new preference

#### Scenario: Dismissing the dialog

- **WHEN** the user presses Escape, clicks the backdrop, or clicks the close button
- **THEN** the dialog closes
