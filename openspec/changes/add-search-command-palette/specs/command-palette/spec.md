## ADDED Requirements

### Requirement: Open the Search command palette

The app SHALL provide a global Search command palette opened both by the **⌘P**
keyboard shortcut and by a dedicated **search button in the titlebar top-right**
(alongside the terminals, settings, and help buttons). The ⌘P handler SHALL call
`preventDefault()` so the keystroke never reaches the webview (suppressing the
browser print dialog). The palette SHALL be a single instance mounted at the app
root, opened/closed through a shared latch store, and SHALL autofocus its text input
on open.

While the palette is open it SHALL **own the keyboard**: the existing global and
inbox shortcuts (e.g. `⌘N`, `⌘J`, `⌘Y`, `⌘↑`/`⌘↓`, `⌘⇧↑`/`⌘⇧↓`) SHALL NOT fire,
exactly as they do not fire while the session launcher is open. `Esc` SHALL close
the palette.

#### Scenario: Open with the keyboard shortcut
- **WHEN** the user presses `⌘P`
- **THEN** the Search palette opens with its input focused
- **AND** the keystroke is prevented from reaching the webview (no print dialog)

#### Scenario: Open with the titlebar button
- **WHEN** the user clicks the titlebar search button
- **THEN** the Search palette opens with its input focused

#### Scenario: Palette owns the keyboard while open
- **WHEN** the Search palette is open and the user presses a global shortcut such as `⌘N` or `⌘↓`
- **THEN** that shortcut does not fire (the launcher does not open, the roster does not advance)

#### Scenario: Close with Escape
- **WHEN** the Search palette is open and the user presses `Esc`
- **THEN** the palette closes

### Requirement: Blended two-group results

The palette SHALL render its results as a single list blended into two labelled
groups, **Sessions** and **Files**, both filtered by the same query string. A single
highlight SHALL move across the flattened, header-skipping sequence of selectable
results so that `↑`/`↓` and `Enter` cross the group boundary seamlessly. Group headers
and the files hint SHALL NOT be selectable.

#### Scenario: Both groups shown under one query
- **WHEN** the user types a query that matches both a session title and a file path
- **THEN** the matching sessions appear under a "Sessions" header and the matching files appear under a "Files" header in one list

#### Scenario: Highlight crosses groups
- **WHEN** the highlight is on the last Sessions result and the user presses `↓`
- **THEN** the highlight moves to the first Files result (skipping the "Files" header)

#### Scenario: No matches
- **WHEN** the query matches no session and no file
- **THEN** the palette indicates that there are no results

### Requirement: Session matching follows the project filter

The Sessions group SHALL list sessions whose title matches the query, scoped by the
active project filter using the same scoping the inbox roster applies (the `All`
filter shows every session; a selected project narrows to that project). Matching
SHALL be case-insensitive and SHALL include live, paused, and **archived** sessions.
Activating a session result SHALL jump to that session in the Inbox focus pane —
switching to the overview if necessary — reusing the inbox's existing selection (and,
for an archived session, its archived-preview) behavior, and SHALL close the palette.

#### Scenario: Title match within the active filter
- **WHEN** a project is selected in the filter and the user types part of a session's title
- **THEN** that session appears in the Sessions group only if it belongs to the selected project

#### Scenario: All filter shows every session
- **WHEN** the project filter is `All` and the user types part of a session's title
- **THEN** the matching session appears regardless of which project it belongs to

#### Scenario: Archived sessions are matchable
- **WHEN** the query matches the title of an archived session
- **THEN** that archived session appears in the Sessions group

#### Scenario: Activating a session jumps to it
- **WHEN** the user activates a session result
- **THEN** the overview is shown and that session is selected in the Inbox focus pane
- **AND** the palette closes

### Requirement: File matching scoped to the selected project

The Files group SHALL list files from the **selected project's** folder tree whose
path matches the query (case-insensitive). When the project filter is `All` or
`Unassigned` (no single concrete project), the Files group SHALL show a muted hint
*"Select a project to search its files"* and SHALL list no files. Activating a file
result SHALL open that file using the existing open behavior (the per-bucket
open-with preference, or the OS default), resolving the project-relative path against
the project's folder, and SHALL close the palette. The number of file results
rendered SHALL be capped for responsiveness.

#### Scenario: File match within the selected project
- **WHEN** a project is selected and the user types part of a file path under that project
- **THEN** the matching file appears in the Files group

#### Scenario: Hint shown when no concrete project is selected
- **WHEN** the project filter is `All` or `Unassigned`
- **THEN** the Files group shows the "Select a project to search its files" hint and lists no files

#### Scenario: Activating a file opens it via the open behavior
- **WHEN** the user activates a file result
- **THEN** the file's absolute path is opened with the configured open-with app for its type (or the OS default)
- **AND** the palette closes

#### Scenario: Rendered files are capped
- **WHEN** the query matches more files than the render cap
- **THEN** only up to the cap of file results is rendered

### Requirement: Empty-query behavior

With an empty query the palette SHALL list all sessions in scope (capped) so the
palette is usable as a quick session switcher, and the Files group SHALL show either
the "Select a project to search its files" hint (no concrete project) or its
(capped) files awaiting a query.

#### Scenario: Empty query lists sessions
- **WHEN** the palette is open and the query is empty
- **THEN** all in-scope sessions are listed (up to the cap) in the Sessions group

### Requirement: Project file enumeration

The backend SHALL expose a command that returns a project's files as
project-relative paths for a given project folder. It SHALL enumerate tracked **and**
untracked-but-not-ignored files when the folder is a git work tree (respecting
`.gitignore`). When the folder is not a git work tree, it SHALL fall back to a
recursive directory walk that excludes heavy/generated directories (`.git`,
`node_modules`, `target`, `dist`, `build`, `.svelte-kit`) and is bounded by a maximum
entry count so a pathological tree cannot hang. Any failure (unreadable path,
non-Tauri environment) SHALL surface to the palette as an empty file list rather than
an error, so the palette degrades to sessions-only.

#### Scenario: Git project lists tracked and untracked files, ignoring gitignored
- **WHEN** the command runs on a git work tree containing tracked files, an untracked file, and a gitignored file
- **THEN** it returns the tracked and untracked files and omits the gitignored file

#### Scenario: Non-git folder falls back to a pruned walk
- **WHEN** the command runs on a folder that is not a git work tree
- **THEN** it returns files found by a recursive walk that excludes `.git`, `node_modules`, `target`, `dist`, `build`, and `.svelte-kit`

#### Scenario: Failure yields an empty list
- **WHEN** enumeration fails or the environment has no backend
- **THEN** the palette receives an empty file list and still shows session results
