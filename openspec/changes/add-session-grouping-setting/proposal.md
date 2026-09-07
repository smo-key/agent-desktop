# Add a user-selectable sessions grouping (status / date / none)

## Why

The sessions panel always groups the roster into the fixed status lanes (Needs
you / In flight / Paused / Archived). Some users want to scan their sessions by
when they were last active, or simply as one flat list, and there is no way to
choose. Pinned and archived sessions are the two invariants users rely on
regardless of grouping: pinned rows must stay at the top, archived rows at the
bottom.

## What Changes

- A new Settings row under "Sessions panel", **Group by**, with the options
  **Status** (default), **Date**, and **None**, persisted across restarts in its
  own `sessionGrouping` settings slice.
- **Status** renders the roster exactly as today (Needs you / In flight / Paused
  lanes, each most-recently-added-first).
- **Date** groups the live sessions by their last-activity time into Today /
  Yesterday / Last 7 days / Older buckets (local calendar days), newest first
  within each bucket. A session with no known activity time counts as newest
  (Today) because it was just launched.
- **None** renders the live sessions as one flat list with no headers, newest
  activity first.
- In every mode, pinned sessions render first in their own "Pinned" section and
  archived sessions render last under the "Archived" header, keeping the
  existing collapse-to-2 / "Show all" toggle and "Delete all" action.
- The roster's view order (which the attention queue, auto-advance, and keyboard
  stepping follow) matches the rendered order in every mode.

## Capabilities

- `agent-roster-display` (ADDED requirement: user-selectable grouping; MODIFIED:
  pinned sessions render above every group in every mode)
