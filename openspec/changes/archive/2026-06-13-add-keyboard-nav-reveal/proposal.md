# Reveal the keyboard-selected list item

## Why

The inbox overview lets the user step through the **session list** with `⌘↑/↓`
and cycle the **project filter** with `⌘⇧↑/↓`. Both lists live in scrollable
containers, but neither scrolls the newly-selected item into view: pressing the
shortcut past the visible window moves the (invisible) selection while the list
stays put, so the user loses track of where they are. The project picker
dropdown (`ProjectSelect`) already does this with `scrollIntoView`, so the inbox
lists are an inconsistency.

The Archived ("done") session lane compounds this: it collapses to its latest
two rows behind a "Show all" toggle. Stepping `⌘↓` onto an archived session
beyond that preview selects a row that isn't even rendered — there is nothing to
scroll to, and the selection is invisible until the user manually expands the
lane.

## What changes

- When keyboard navigation moves the selected **session** (`shownId`), the
  selected row is scrolled into view within the session list when it is not
  already fully visible.
- When keyboard navigation moves the selected **project filter**
  (`projectFilter.selected`), the active project row is scrolled into view
  within the project panel when it is not already fully visible.
- When keyboard navigation lands the session selection on an archived session
  that is hidden behind the Archived lane's collapsed preview, the lane
  auto-expands ("Show all") so the selected row is rendered and can be revealed.

All three are reveal-only: they change scroll position / lane expansion, never
the selection logic, the order, or which agent is shown. A selection that is
already fully visible is left untouched (no gratuitous scrolling).

## Impact

- Affected specs: `agent-roster-display` (session-list reveal + archived
  auto-expand), `projects` (project-filter reveal).
- Affected code: `src/lib/overview/Inbox.svelte` (session reveal effect +
  archived auto-expand effect + a new pure helper), `src/lib/projects/ProjectPanel.svelte`
  (project-filter reveal effect). No backend / persistence changes.
