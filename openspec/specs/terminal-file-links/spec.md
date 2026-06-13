# terminal-file-links Specification

## Purpose
TBD - created by archiving change add-terminal-file-links. Update Purpose after archive.
## Requirements
### Requirement: Modifier-gated file link affordance

The terminal SHALL treat a token as an actionable file link only while the ⌘ (Command/Meta) modifier is held. When ⌘ is held and the pointer is over a token that resolves to an existing filesystem path, the terminal SHALL render that token with a dotted underline and a pointer cursor. When ⌘ is not held, no link affordance SHALL be shown and the token SHALL behave as ordinary terminal text.

#### Scenario: Underline appears on ⌘-hover over an existing path

- **WHEN** the user holds ⌘ and moves the pointer over a token that resolves to an existing file or directory
- **THEN** that token is rendered with a dotted underline and the cursor becomes a pointer

#### Scenario: No affordance without the modifier

- **WHEN** the user hovers over the same token without holding ⌘
- **THEN** no underline or pointer cursor is shown and the token behaves as ordinary text

#### Scenario: Underline appears when ⌘ is pressed while already hovering

- **WHEN** the pointer is already stationary over an existing path and the user then presses ⌘
- **THEN** the dotted underline appears without requiring further pointer movement

#### Scenario: Underline clears on release or leave

- **WHEN** the user releases ⌘, moves the pointer off the token, or the window loses focus while ⌘ was held
- **THEN** the dotted underline and pointer cursor are removed immediately

#### Scenario: Non-existent tokens are not linkified

- **WHEN** the user ⌘-hovers over a token that does not resolve to any existing filesystem path
- **THEN** no underline or pointer cursor is shown

### Requirement: cwd-aware path resolution

The terminal SHALL resolve the hovered token to an absolute path before validating its existence. Absolute paths SHALL be used directly; `~` and `~/...` SHALL be expanded against the user's home directory; all other tokens SHALL be resolved relative to the pane's working directory. A token SHALL be linkified only if the resolved path exists on disk.

#### Scenario: Relative path resolves against pane cwd

- **WHEN** a pane has working directory `/Users/me/proj` and the user ⌘-hovers `src/lib/foo.ts` which exists at `/Users/me/proj/src/lib/foo.ts`
- **THEN** the token is linkified and resolves to `/Users/me/proj/src/lib/foo.ts`

#### Scenario: Dot-relative path resolves against pane cwd

- **WHEN** the user ⌘-hovers `./build` or `../README.md` and the corresponding path exists relative to the pane's working directory
- **THEN** the token is linkified and resolves to that absolute path

#### Scenario: Home-relative path expands against HOME

- **WHEN** the user ⌘-hovers `~/notes.md` and `$HOME/notes.md` exists
- **THEN** the token is linkified and resolves to `$HOME/notes.md`

#### Scenario: Absolute path resolves directly

- **WHEN** the user ⌘-hovers `/etc/hosts` which exists
- **THEN** the token is linkified and resolves to `/etc/hosts`

### Requirement: Token decoration stripping

Before resolution, the terminal SHALL strip from the candidate token: a trailing `:line` or `:line:col` suffix, one layer of surrounding quotes/backticks, one layer of wrapping brackets (`()`, `[]`, `<>`), and trailing sentence punctuation. The link's underline range SHALL cover only the stripped path, not the discarded decorations.

#### Scenario: Line/column suffix is stripped

- **WHEN** the user ⌘-hovers `src/foo.ts:42:8` and `src/foo.ts` resolves to an existing file
- **THEN** the token is linkified and resolves to that file (the `:42:8` suffix is ignored)

#### Scenario: Surrounding quotes and trailing punctuation are stripped

- **WHEN** the user ⌘-hovers a token printed as `"README.md".` and `README.md` exists in the pane cwd
- **THEN** the token resolves to `README.md` and the underline covers only `README.md`, not the quotes or trailing period

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

### Requirement: No regression to ordinary terminal interaction

The link feature SHALL NOT alter terminal behaviour when ⌘ is not held. Text selection, scrolling, copy/paste, and plain (no-modifier) clicks SHALL behave exactly as before.

#### Scenario: Plain click and selection unaffected

- **WHEN** the user clicks or drags to select text without holding ⌘
- **THEN** selection, scrolling, and copy/paste behave exactly as they did before this feature

