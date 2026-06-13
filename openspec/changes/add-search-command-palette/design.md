## Context

The app is currently overview-first: the Inbox (`Inbox.svelte`) owns session selection
and teleports the single mounted workspace surface into its focus pane. Grid mode
(`view.isGrid`) is vestigial — its PaneNodes stay mounted but no UI calls
`view.cycle()` / `view.show('grid')`, so the app is effectively overview-only.

Existing patterns this design leans on:
- **Modal latches** like `launcherStore`/`helpStore`: a singleton with `open`/`visible`
  `$state` and `open()/close()/toggle()`, mounted once at the `+page.svelte` root with a
  `position:fixed` backdrop. The global `onKeydown` in `+page.svelte` and the inbox's
  `onNavKey` already **bail when `launcher.open`** so the modal owns the keyboard.
- **Cross-component requests** like `workspace.lastLaunchedId`: a value the Inbox watches
  in an `$effect` and reacts to by calling its own `selectAgent`. The palette reuses this
  shape rather than reaching into the Inbox's internals.
- **Session roster**: `buildRoster(...)` (already imported by `+page.svelte` for the
  alert driver) yields `AgentRow[]`; titles come from `titles.titleFor(paneId) ?? name`;
  `filterRowsByProject(rows, projectFilter.selected)` is the same project scoping the
  roster uses.
- **Open behavior**: `openWith.openFile(absPath)` routes a path to the user's per-bucket
  app (or the OS default) via the Rust `open_path` command.
- **Backend shell-outs**: `git.rs` runs git via `std::process::Command`; there is no
  `walkdir`/`ignore` crate, and we will not add one.

## Goals / Non-Goals

**Goals:**
- One global palette reachable by ⌘P and a titlebar button.
- Find a session by title (filter-scoped, incl. archived) and jump to it in the Inbox
  focus pane.
- Find a file in the selected project's tree and open it via the open behavior.
- Keyboard-first, owns the keyboard while open; pure, unit-testable result/nav model.
- Reuse existing machinery (roster, titles, project filter, open-with, inbox selection)
  rather than duplicating it.

**Non-Goals:**
- File **content** search (filenames/paths only).
- A general command/action palette (no "run X" entries).
- Multi-project file search (files are scoped to the one selected project).
- Re-enabling or special-casing grid mode.
- Fuzzy-match sophistication beyond a simple, predictable subsequence + rank.

## Decisions

### D1 — Blended two-group list, single query
One input drives both groups; results render under **Sessions** and **Files** headers in
a single list the user arrows through. *Alternative considered:* a prefix/Tab mode switch
(VS Code style) — rejected as a second step to reach files and less discoverable for a
two-source palette. The highlight is a single index over the **flattened, header-skipping**
result sequence so `↑/↓` and `Enter` cross the group boundary seamlessly.

### D2 — Sessions follow the project filter; Files require a concrete project
Session matching runs over `filterRowsByProject(buildRoster(...), projectFilter.selected)`
— identical scoping to the roster, so `All` shows everything and a selected project
narrows both groups consistently. Files, by contrast, need a concrete folder to enumerate,
so when `projectFilter.selected` is `ALL`/`UNASSIGNED` the Files group renders only the
muted hint *"Select a project to search its files."* *Alternative:* enumerate every
project's files under `All` — rejected (heavy, and the user chose project-scoped files).

### D3 — Jump-to-session via a `focusRequest` store, consumed by the Inbox
The palette writes `focusRequest.request(paneId)` (a `paneId` field plus a monotonically
bumped nonce so re-selecting the same id re-fires). The Inbox adds one `$effect` that
watches the nonce and calls its existing `selectAgent(paneId)`; the palette also calls
`view.show('overview')` defensively. This keeps **all** session-selection, archived-preview,
and surface-teleport logic in its single owner (the Inbox). *Alternative:* have the palette
resolve `navigateTarget` and mutate the workspace directly — rejected as duplicating the
Inbox's selection/preview behavior and bypassing its focus effect.

### D4 — Backend file enumeration: git first, bounded walk fallback
`project_files(project_path) -> Vec<String>` runs
`git ls-files --cached --others --exclude-standard -z` in the project dir: tracked **plus**
untracked-but-not-ignored files, `.gitignore`-respected, fast, NUL-delimited (so paths with
spaces/newlines survive). If the dir is not a git work tree (command errors / non-zero),
fall back to a recursive `std::fs::read_dir` that **prunes** `.git`, `node_modules`,
`target`, `dist`, `build`, `.svelte-kit` and **caps** total entries (~20k) so a pathological
tree can't hang the UI. Returns project-relative POSIX paths; the frontend joins
`project.path` to open. *Alternatives:* a recursive walk always (slower, re-implements
gitignore) or adding the `ignore` crate (new dependency, against the no-new-crate constraint)
— both rejected.

### D5 — Pure result model in `searchModel.ts`
A framework-free module holds: a case-insensitive **subsequence** matcher with a small rank
(prefer contiguous / start-of-segment / basename matches), the grouping into
`{ sessions, files }`, the cap logic, and the **highlight-index navigation** (move/clamp or
wrap across the flattened selectable items, skipping headers and the files hint). Mirrors how
`roster`/`inbox` keep pure logic out of the `.svelte` component so it is unit-tested without a
DOM. The `.svelte` component and the per-project file cache (`projectFiles.svelte.ts`) hold
only reactive/IO glue.

### D6 — Lazy, per-project file cache
`projectFiles.svelte.ts` loads the file list when the palette opens for a concrete project
and memoizes it keyed by project path for the session; switching projects loads on demand.
Invoke failures (non-Tauri preview, bad path) resolve to `[]`, so the palette degrades to
sessions-only rather than erroring.

## Risks / Trade-offs

- **Stale file list** (files added/removed after caching) → acceptable for a session-scoped
  cache; the list refreshes when the palette is reopened after a project switch. A future
  refresh-on-open is possible if it proves annoying.
- **Very large repos** inflate the file list → matching/render are capped (~50 shown) and
  the backend caps the walk (~20k); enumeration is a single git call, off the main thread
  via the async invoke.
- **⌘P is the browser/webview print shortcut** → the handler calls `preventDefault()`; this
  is the same approach the existing `⌘W`/`⌘J` handlers use to keep keystrokes off the webview.
- **Keyboard-ownership regressions** (a global shortcut firing under the palette) → add
  `searchPalette.open` to every guard that already checks `launcher.open`, and cover the
  guard in the shortcuts test the same way the launcher case is covered.
- **`focusRequest` racing the Inbox mount** (palette used before the Inbox exists) → the
  store holds the latest request; the Inbox's `$effect` reads it on mount, so a request made
  while overview is rendering is honored. Defensive `view.show('overview')` ensures the Inbox
  is mounted.

## Migration Plan

Additive only — no data, schema, or persisted-format changes; nothing to roll back beyond
reverting the change. The new Rust command is registered alongside existing commands; no
capability file edits are required (custom commands are exposed via `generate_handler`, not
plugin capabilities).

## Open Questions

None — the three design decisions (blended list, project-scoped files with hint, jump to the
Inbox focus pane) and the two scope decisions (sessions follow the filter, archived included)
are settled with the user.
