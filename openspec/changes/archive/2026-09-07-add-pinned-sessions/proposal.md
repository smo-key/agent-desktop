# Pin sessions to the top of the roster

## Why

Sessions move between lanes as their status changes, so the ones a user cares
most about drift around the list. Users want to keep chosen sessions in one
fixed place at the top.

## What Changes

- Every roster row's context menu offers "Pin to top" / "Unpin".
- Pinned sessions render in a "Pinned" group above every lane, most recently
  pinned first, keeping their lane accent and status dot; a pin glyph leads
  the title.
- Pinned pane ids persist in the durable `ui` settings slice; deleting a
  session for good drops it from the list.

## Capabilities

- `agent-roster-display` (ADDED requirement)
- `ui-preferences` (MODIFIED requirement)
