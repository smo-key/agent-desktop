## Why

There is no fast way to reach a specific session or project file. Finding a session
means scanning the roster by eye; opening a file means leaving the app for a terminal
or Finder. A keyboard-first search palette — the near-universal ⌘P convention — lets
the user jump to either in a couple of keystrokes, without changing the project filter
or hunting through lanes.

## What Changes

- Add a global **Search** command palette opened by **⌘P** and by a new **search
  button in the titlebar top-right** (beside the terminals / settings / help buttons).
- The palette is one text input over a results list blended into two labelled groups:
  - **Sessions** — sessions matched by title, following the active project filter
    (the `All` filter shows every session). Includes live, paused, and archived
    sessions. Activating one **jumps to it in the Inbox focus pane**.
  - **Files** — files in the **selected project's** tree, matched by path. Activating
    one **opens it via the existing open behavior** (the per-bucket open-with app).
    When the project filter is `All` / `Unassigned` (no single project), the Files
    group shows a muted hint *"Select a project to search its files"* and lists nothing.
- Keyboard-driven: type to filter both groups; `↑`/`↓` move a single highlight across
  the flattened results (skipping group headers); `Enter` activates the highlight;
  `Esc` closes. While open, the palette **owns the keyboard** — the existing global /
  inbox shortcuts (`⌘N`, `⌘J`, `⌘↑/↓`, …) bail when it is open, exactly as they do for
  the launcher.
- Empty query shows all (filter-scoped) sessions, capped; rendered files are capped
  (~50) for responsiveness.
- Add a backend primitive to enumerate a project's files (tracked + untracked-but-not-
  ignored via git, with a bounded directory-walk fallback for non-git folders).
- Document **⌘P** in the keyboard-shortcuts help registry (Global section).

Out of scope: searching file **contents**, command/action palette entries, and
searching files across multiple projects at once.

## Capabilities

### New Capabilities
- `command-palette`: the global ⌘P / titlebar Search palette — its entry points,
  the two-group (Sessions / Files) blended result model, project-filter-scoped session
  matching, project-file enumeration and matching, jump-to-session and open-file
  activation, and keyboard ownership while open.

### Modified Capabilities
- `keyboard-shortcuts`: the Global section of the help registry gains `⌘P` (open
  Search), and the title-bar buttons it documents gain the Search button.

## Impact

- **Frontend (new)** `src/lib/search/`: `searchPaletteStore.svelte.ts` (open/close
  latch), `searchModel.ts` (pure matcher + ranking + grouping + highlight-index math),
  `projectFiles.ts` (invoke wrapper) + `projectFiles.svelte.ts` (per-project cache),
  `SearchPalette.svelte` (the modal). New `src/lib/overview/focusRequest.svelte.ts`
  (session-jump request store, consumed by the Inbox like `workspace.lastLaunchedId`).
- **Frontend (edits)** `src/routes/+page.svelte` (⌘P handler with `preventDefault`,
  mount `<SearchPalette/>`, titlebar button, add palette to keyboard-ownership guards);
  `src/lib/overview/Inbox.svelte` (consume `focusRequest` → `selectAgent`);
  `src/lib/icons/projectIcons.ts` (add a `search` glyph); `src/lib/ui/shortcuts.ts`
  (document ⌘P).
- **Backend (new)** Rust `project_files(project_path) -> Vec<String>` command (a small
  `files.rs` helper, registered in `lib.rs`), using `git ls-files --cached --others
  --exclude-standard -z` with a bounded recursive `std::fs::read_dir` fallback
  (excluding `.git`, `node_modules`, `target`, `dist`, `build`, `.svelte-kit`; capped).
  No new crates — git is shelled out to, matching the existing `git.rs` precedent.
- **Reused, unchanged**: `openWith.openFile` (open behavior), `buildRoster` /
  `titles` / `projectFilter` (session list), `view.show('overview')` (defensive).
