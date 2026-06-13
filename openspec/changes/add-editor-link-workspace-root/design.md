## Context

File links open in an external editor via one Rust command, `open_path(path,
app)` (`src-tauri/src/lib.rs`), which runs `open -a <app> <file>` on macOS (or
`open <file>` for the OS default). Two frontend sites reach it:

- `openWith.openFile(path)` (`src/lib/settings/openWith.svelte.ts`) — used
  directly by the terminal ⌘-click handler (`TerminalPane.svelte`), which passes
  the already-resolved absolute file path and **discards** the pane's `cwd`.
- `openInEditor(cwd, file)` (`src/lib/overview/editor.ts`) — used by the
  transcript/markdown links and the git commit popover (`GitInfo.svelte`). It
  receives `cwd` but immediately collapses it into one absolute path via
  `resolveFile()` and then calls `openFile(path)`, so `cwd` is lost.

Because the editor only ever receives the file, Cursor/VS Code reveal it scoped
to the file's folder (or a reused window) rather than opening the project as a
workspace. The agent's working directory — the desired workspace root — is
present at both call sites but never reaches the editor.

## Goals / Non-Goals

**Goals:**
- Open a file link with its project/working directory as the editor's workspace
  root, so a project-aware editor opens the project AND reveals the file.
- Apply to both open sites (terminal ⌘-click and transcript/markdown link), plus
  the commit popover which already supplies a project path.
- Preserve today's behavior for System Default and for apps that can't take a
  folder-as-workspace argument.

**Non-Goals:**
- Line/column positioning (`--goto file:line:col`). The `:line:col` suffix stays
  stripped; per-editor CLI invocation is a separate future change.
- Changing classification/category routing or the Settings dialog.
- Non-macOS platforms (the command is macOS `open`-based today).

## Decisions

### D1 — Pass the workspace as a second `open -a` argument, not via an editor CLI

`open -a "<editor>" <workspace> <file>` hands the editor both paths; project-aware
editors (Cursor, VS Code, Zed, Sublime) open the folder as a workspace and reveal
the file, reusing an existing project window when one is open.

- **Alternative — editor-specific CLI** (`cursor --goto`, `code <dir> --goto`):
  rejected for this change. It requires locating each editor's CLI binary (PATH
  dependence, install state) and per-editor argument shapes, and only pays off if
  we also do line positioning — which is out of scope. `open -a` keeps the
  generic-app model intact and adds no new failure surface.

### D2 — Gate the workspace argument on a project-aware-editor allowlist (frontend)

The frontend decides whether to forward a workspace, because that is where the
resolved app name is known and matches the Settings choices. A new
`PROJECT_AWARE_EDITORS` set — `Cursor`, `Visual Studio Code`, `Zed`,
`Sublime Text` — is the gate. `openFile(path, workspace?)` forwards `workspace`
to the backend only when `resolveApp()` returns a name in that set; otherwise it
omits it (existing file-only behavior).

- This deliberately **excludes** `TextEdit` and `Finder` (in the curated lists)
  and any custom app name the user typed, since `open -a "TextEdit" <dir> <file>`
  would mishandle the directory argument.
- **Alternative — gate in Rust**: rejected. The Rust side would have to duplicate
  the app-name knowledge; the allowlist belongs next to `APP_CHOICES`/`EDITORS`.

### D3 — `open_path` gains an optional `workspace`; backend adds one containment check

`open_path(path, app, workspace?)`: when `app` is set AND `workspace` is a
non-empty string **that contains `path`**, run `open -a <app> <workspace> <file>`;
otherwise behave exactly as today (`open -a <app> <file>`, or `open <file>` with
no app). The backend performs no allowlist logic — it trusts the frontend's
project-aware-editor decision — but it DOES verify containment, because that is
the one check the frontend cannot do reliably: the file path is canonicalized
(symlinks resolved) by `resolve_path`, while the pane `cwd` is not, so a
prefix test in TS would give false negatives. `path_within` canonicalizes both
sides and checks the prefix; a workspace that doesn't contain the file (an
absolute path clicked outside the project, or a non-file target like a URL whose
`canonicalize` fails) is dropped, so an unrelated project is never opened. The
arg construction is a pure helper (`open_args`) so the launch wiring is
unit-tested without spawning. System Default (`app = None`) never receives a
workspace, so a folder can never be handed to the OS default handler (which would
open Finder).

### D4 — `openInEditor` forwards `cwd` instead of pre-resolving it away

`openInEditor(cwd, file)` keeps resolving the file to an absolute path (so the
editor gets a concrete file), but now also passes `cwd` as the workspace to
`openFile(resolvedFile, cwd)`. The terminal ⌘-click handler passes the pane
`cwd` directly: `openWith.openFile(armedPath, cwd)`.

## Risks / Trade-offs

- [Editor reuses the wrong window when the project is already open] → Acceptable
  and generally desired: project-aware editors focus the existing project window
  and reveal the file, which is exactly the requested behavior.
- [A working directory that is a git worktree, not the "main" repo folder] →
  Passing the agent's actual `cwd` (the worktree) as the workspace is correct —
  that is where the file lives; opening the worktree as the workspace is the
  intended result.
- [Custom editor the user typed is project-aware but not on the allowlist] → It
  falls back to file-only (no regression). The allowlist can grow later; we favor
  not breaking non-folder apps over covering every possible editor immediately.
- [Non-macOS] → Unchanged scope; `open_path` is macOS-only today and this keeps
  that boundary.

## Migration Plan

Pure additive behavior, no persisted-data or schema change. The new `workspace`
argument is optional at every layer, so omitting it reproduces current behavior.
Rollback is reverting the diff; no migration or cleanup needed.

## Open Questions

None — interview resolved System-Default behavior (file only), the project-aware
allowlist (Cursor / VS Code / Zed / Sublime), and line positioning (out of scope).
