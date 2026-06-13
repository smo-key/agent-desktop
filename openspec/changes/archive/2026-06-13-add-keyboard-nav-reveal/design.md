# Design

## Reveal mechanism: reactive `$effect`, not imperative key-handler code

The selected session (`shownId`) and project filter (`projectFilter.selected`)
already change reactively. Rather than bolt scroll calls onto the `⌘↑/↓` /
`⌘⇧↑/↓` branches of `onNavKey`, each component gets a small `$effect` keyed on
its selection that, after `tick()`, finds the selected element and calls
`element.scrollIntoView({ block: 'nearest' })`.

This mirrors the established convention in `ProjectSelect.svelte` (its menu
already does exactly this for the roving highlight) and has two advantages over
the imperative approach:

- It is self-contained per component — `ProjectPanel` owns the project-row DOM,
  so its reveal lives there rather than reaching across from the inbox key
  handler.
- It also covers selection that arrives by paths other than the arrow keys
  (e.g. the alert-click-focus select path), which is the desired behavior — the
  selected item should be visible however it became selected.

`{ block: 'nearest' }` is load-bearing: the browser does nothing when the
element is already fully within the scrollport, so clicks and auto-advance to an
already-visible row never trigger a jump. `tick()` is required because the
selection is Svelte state — the `.sel` / `.active` class lands on the new
element only after the DOM updates.

The selected session element is found by the `.sel` class, which the markup
already applies to both lane rows and the pinned-coordinator / start-affordance
slot, so a single query covers every nav target.

## Archived auto-expand: a pure decision + a guarded effect

The Archived lane renders only the first `ARCHIVED_PREVIEW` (2) rows unless
`showAllArchived` is set. A hidden archived row is not in the DOM, so it cannot
be scrolled to. The reveal therefore needs the lane expanded first.

The decision is extracted into a pure, unit-tested helper:

```ts
archivedNavNeedsExpand(
  selectedPaneId: string | null,
  archivedPaneIds: string[],   // the done-lane order (newest-first)
  previewCount: number,
  showingAll: boolean
): boolean
```

It returns `true` only when the lane is collapsed and the selected pane sits at
or beyond `previewCount` in the archived order. A guarded `$effect` in the inbox
flips `showAllArchived = true` when it returns `true`. The write is monotonic —
once expanded the helper returns `false` (it short-circuits on `showingAll`), so
there is no reactive loop. Effect ordering then resolves naturally: the expand
re-renders the lane, and the session-reveal effect (which also reads
`showAllArchived`) re-runs and scrolls the now-rendered row into view.

The lane is never auto-collapsed; expansion is a one-way reveal, matching the
manual "Show all" toggle which the user can still collapse explicitly.

## Testing

`archivedNavNeedsExpand` is covered by vitest (empty list, within preview, at
the preview boundary, beyond preview, already showing all, null selection). The
`scrollIntoView` calls are not unit-testable (jsdom has no layout, so
`scrollIntoView` is a no-op), so the reveal behavior itself is confirmed by
manual verification in the running app.
