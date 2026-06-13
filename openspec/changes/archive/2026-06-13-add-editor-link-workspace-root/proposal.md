## Why

Opening a file link from the TUI (a terminal ⌘-click or a transcript/markdown
link) launches the configured editor with only the file path — e.g.
`open -a "Cursor" /proj/folder/file.ts`. macOS hands the editor just the file, so
Cursor/VS Code reveal it scoped to the file's own folder (or a reused window),
never the project. The user expects a file under `agent-desktop/folder/file.ts`
to open the **agent-desktop project** as the workspace with that file revealed
inside it. The agent's working directory is already known at every open site, so
the fix is to thread it through as the editor's workspace root.

## What Changes

- When opening a file in a **project-aware editor** (Cursor, Visual Studio Code,
  Zed, Sublime Text), also pass the agent's working/project directory as the
  workspace root, so the editor opens the project AND reveals the file
  (`open -a "<editor>" <workspace> <file>`).
- The terminal ⌘-click path stops discarding the pane's working directory: it
  passes the pane `cwd` as the workspace root alongside the resolved file.
- The transcript/markdown link path stops collapsing `cwd` into the file path
  before launch: it forwards `cwd` as the workspace root.
- Workspace root is passed **only** when (a) the file's category resolves to a
  configured, project-aware editor, (b) a working directory is known, and (c) that
  working directory actually contains the file. "System Default" categories and
  non-project-aware apps (e.g. TextEdit, Finder, custom app names) keep the
  existing file-only behavior — `open <folder>` under the OS default would wrongly
  launch Finder, and apps that don't understand a folder-as-workspace argument
  must not receive one. The containment check (c) is enforced in the backend,
  where both paths can be canonicalized, so clicking an absolute path outside the
  project never opens an unrelated project as a workspace.
- Out of scope: jumping to a specific line/column (the `:line:col` suffix is
  still stripped before opening; per-editor `--goto` invocation is a future
  change).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `open-with-preferences`: the "Opening a file honors its category preference"
  requirement is extended so that, when the resolved application is a
  project-aware editor and a known working directory contains the file, the open
  passes that directory as a workspace root in addition to the file. System-default
  and non-project-aware targets, and a working directory that does not contain the
  file, are unchanged (file only).
- `terminal-file-links`: the "Open on ⌘-click via open-with preferences"
  requirement is extended so the ⌘-click passes the pane's working directory as
  the workspace root (subject to the same project-aware-editor gating).

## Impact

- Frontend:
  - `src/lib/settings/openWith.svelte.ts` — `openFile(path, workspace?)` gains an
    optional workspace arg; a project-aware-editor allowlist gates whether the
    workspace is forwarded to the backend.
  - `src/lib/overview/editor.ts` — `openInEditor(cwd, file)` forwards `cwd` as the
    workspace instead of dropping it after resolution.
  - `src/lib/TerminalPane.svelte` — the ⌘-click handler passes the pane `cwd`.
  - `src/lib/usage/GitInfo.svelte` — already passes the commit project path;
    benefits with no change.
- Backend:
  - `src-tauri/src/lib.rs` — `open_path` gains an optional `workspace`; when an
    app and a workspace that contains the file are present it runs
    `open -a <app> <workspace> <file>` (arg construction via a pure `open_args`
    helper; containment via `path_within`, which canonicalizes both paths).
- Tests: open-with project-aware-editor gating and `openFile` workspace
  forwarding; `openInEditor` cwd forwarding; Rust `open_args` arg construction and
  `path_within` containment.
