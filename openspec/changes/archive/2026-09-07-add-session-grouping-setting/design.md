# Design

## Persistence

A new settings store, `src/lib/settings/sessionGrouping.svelte.ts`, mirrors
`compactMode.svelte.ts`: a `sessionGrouping` slice of `settings.json` holding
`{ mode: 'status' | 'date' | 'none' }`, a pure `parseSessionGroupingPrefs`
normalizer (any malformed shape → `status`), `setMode`, and a merge-aware
`saveSettingsSlice` write so sibling slices survive. Loaded once on app mount in
`+page.svelte` beside the other settings stores.

## Pure grouping

A framework-free module `src/lib/overview/grouping.ts` owns the mode logic so it
is unit-testable and the Inbox stays a thin renderer:

- `dateBucketFor(lastTs, nowMs)` → `today | yesterday | week | older`, computed on
  LOCAL calendar days (midnight boundaries), `null` → `today`.
- `buildRosterGroups(orderedRows, mode, pinnedIds, nowMs)` → an ordered
  `RosterGroup[]` (`{ key, kind, title, lane?, rows }`):
  1. `pinned` (rows in the pinned list, in pin order) — omitted when empty;
  2. the mode body: `status` → one `lane` group per `attn`/`flight`/`paused` in
     `LANE_ORDER` preserving the incoming order; `date` → one `date` group per
     bucket in Today → Older order, rows sorted by `lastTs` descending (null
     first); `none` → a single headerless `flat` group sorted by `lastTs`
     descending (null first);
  3. `archived` (rows whose lane is `done`, incoming order = newest-first).
  Empty groups are dropped. Never mutates inputs.

The input is the existing `pinRowsToTop(orderRowsByLane(rows, laneOrder), pinned)`
order, so in Status mode the result is identical to today's rendering.

## Inbox wiring

`Inbox.svelte` derives `groups = buildRosterGroups(...)` and then
`viewRows = groups.flatMap(g => g.rows)`, so the attention queue, auto-advance,
keyboard stepping, and rendering share one order in every mode. The template
iterates `groups`: `pinned` and `archived` render as today (the archived group
keeps the preview/Show-all/Delete-all behaviour, sourced from the group's rows
instead of `renderGrouped.done`); `lane` groups keep their lane colour classes;
`date` groups use a neutral header; the `flat` group renders no header. Each row
still receives `laneForRow(r)` for its accent, status dot, and menu.

## Settings UI

`SettingsModal.svelte` adds a "Group by" `Dropdown` (Status / Date / None) as
the second row of "Sessions panel", after Density.
