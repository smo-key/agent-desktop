# Tasks

## 1. Archived auto-expand decision (pure, TDD)
- [x] 1.1 Write failing vitest for `archivedNavNeedsExpand(selectedPaneId, archivedPaneIds, previewCount, showingAll)` covering: empty archived list, selection within preview, selection at the preview boundary, selection beyond preview (→ true), already showing all (→ false), null selection (→ false), and a selection not in the archived list (→ false).
- [x] 1.2 Implement the pure helper to make the tests pass.

## 2. Session-list reveal + archived auto-expand (Inbox.svelte)
- [x] 2.1 Add a guarded `$effect` that flips `showAllArchived = true` when `archivedNavNeedsExpand` returns true for the current `shownId` against the Archived (`done`) lane order.
- [x] 2.2 Add a `$effect` keyed on `shownId` (and `showAllArchived`) that, after `tick()`, scrolls the selected `.sel` element into view within the session list with `{ block: 'nearest' }`.

## 3. Project-filter reveal (ProjectPanel.svelte)
- [x] 3.1 Add a `$effect` keyed on `projectFilter.selected` that, after `tick()`, scrolls the active `.pp-item.active` row into view within the panel with `{ block: 'nearest' }`.

## 4. Verify
- [x] 4.1 `npm run test` (or the repo's vitest command) passes, including the new helper tests. (1083 passing.)
- [x] 4.2 `npm run check` / lint passes (no Svelte effect-loop warnings). (0 errors, 0 warnings.) Scenario-coverage gate (`npm run coverage`) passes — the two `projects` reveal scenarios are registered as headless-exempt (jsdom has no layout, so `scrollIntoView` can't be asserted).
- [x] 4.3 Manual verification in the running app: `⌘↑/↓` reveals off-screen sessions; `⌘↓` onto a hidden archived session expands the lane and reveals it; `⌘⇧↑/↓` reveals off-screen project rows; already-visible selections do not jump. (Confirmed live in-app.)
