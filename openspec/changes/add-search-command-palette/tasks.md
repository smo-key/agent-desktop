## 1. Backend — project file enumeration

- [ ] 1.1 Add a `files.rs` helper in `src-tauri/src/` with a pure-ish function that, given a project path, returns project-relative POSIX paths: run `git ls-files --cached --others --exclude-standard -z` (NUL-split) when the path is a git work tree; otherwise a recursive `std::fs::read_dir` walk that prunes `.git`, `node_modules`, `target`, `dist`, `build`, `.svelte-kit` and is bounded by a max-entry cap (~20k).
- [ ] 1.2 Expose `#[tauri::command] project_files(project_path: String) -> Result<Vec<String>, String>` and register it in the `generate_handler!` list in `lib.rs`.
- [ ] 1.3 Rust unit tests over temp dirs (precedent: `specialists` tests): a git work tree returns tracked + untracked and omits a gitignored file; a non-git folder returns walked files and excludes the pruned dirs; the cap is honored.

## 2. Pure search model

- [ ] 2.1 Create `src/lib/search/searchModel.ts`: a case-insensitive subsequence matcher with a simple rank (prefer contiguous / start-of-segment / basename matches), grouping into `{ sessions, files }`, the render caps, and the empty-query behavior.
- [ ] 2.2 Add highlight-index navigation to `searchModel.ts`: the flattened list of selectable items (skipping group headers and the files hint), and a move/clamp-or-wrap function for `↑`/`↓`.
- [ ] 2.3 Unit tests for `searchModel.ts`: matching/ranking, session vs file grouping, caps, empty-query, and highlight navigation crossing the group boundary + skipping non-selectable rows.

## 3. Stores and IO

- [ ] 3.1 Create `src/lib/search/searchPaletteStore.svelte.ts` — a singleton latch (`open` `$state`, `open()/close()/toggle()`), mirroring `launcherStore`/`helpStore`.
- [ ] 3.2 Create `src/lib/overview/focusRequest.svelte.ts` — a request store with a `paneId` field and a bumped nonce so re-requesting the same id re-fires; a `request(paneId)` method.
- [ ] 3.3 Create `src/lib/search/projectFiles.ts` — a thin `invoke('project_files', { projectPath })` wrapper returning `string[]`, resolving to `[]` on any error / non-Tauri.
- [ ] 3.4 Create `src/lib/search/projectFiles.svelte.ts` — a per-project-path cache that loads lazily (when the palette opens for a concrete project) and memoizes for the session.
- [ ] 3.5 Unit tests for `searchPaletteStore` (open/close/toggle) and `focusRequest` (nonce bumps, re-request).

## 4. Palette component

- [ ] 4.1 Add a `search` (magnifying-glass) glyph to `src/lib/icons/projectIcons.ts` (Lucide-style path, matching the existing set).
- [ ] 4.2 Create `src/lib/search/SearchPalette.svelte` — `position:fixed` backdrop modal (Launcher-style), autofocused input, the two grouped lists from `searchModel`, the files hint when no concrete project, and the cap rendering. Wire sessions from `buildRoster(...)` + `titles` + `filterRowsByProject(projectFilter.selected)`, and files from the `projectFiles` cache for the selected project.
- [ ] 4.3 Keyboard handling in the component: type to filter, `↑`/`↓` move the highlight via `searchModel` nav, `Enter` activates the highlight, `Esc` closes. Activating a session calls `view.show('overview')` + `focusRequest.request(paneId)`; activating a file calls `openWith.openFile(absPath)`; both close the palette.

## 5. Wiring into the app

- [ ] 5.1 `src/routes/+page.svelte`: add the `⌘P` branch to `onKeydown` (`preventDefault`, `searchPalette.toggle()`), placed with the other global shortcuts; mount `<SearchPalette />` at the root next to `<Launcher />`.
- [ ] 5.2 `src/routes/+page.svelte`: add the titlebar **search button** in `.tb-right` (Icon `search`, tooltip "Search (⌘P)", `onclick={() => searchPalette.open()}`), before the terminals/settings/help buttons.
- [ ] 5.3 `src/routes/+page.svelte`: add `searchPalette.open` to the keyboard-ownership guards so global shortcuts bail while the palette is open (same treatment as `launcher.open`); confirm the inbox `onNavKey` bails too.
- [ ] 5.4 `src/lib/overview/Inbox.svelte`: add an `$effect` that watches `focusRequest` (by nonce) and calls `selectAgent(paneId)`, mirroring the `workspace.lastLaunchedId` watcher.
- [ ] 5.5 `src/lib/ui/shortcuts.ts`: document `⌘P` (open Search) in the Global group.

## 6. Verification

- [ ] 6.1 `npm run check` (type-check) and `npm run test` (unit) pass; `npm run coverage` (scenario coverage) passes for the new spec.
- [ ] 6.2 Manual/live in `npm run dev`: `⌘P` and the titlebar button open the palette; typing filters both groups; `Enter` on a session jumps to it in the focus pane (incl. an archived one); `Enter` on a file opens it with the configured app; the `All` filter shows the files hint; `Esc` closes; global shortcuts do not fire while open.
