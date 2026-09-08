# Session grouping follow-ups

## Why

Two adjustments after the grouping setting shipped: a never-used session (no
activity timestamp) sat permanently at the top of the Date/None lists, and a
pinned session that was archived stayed under "Pinned" instead of "Archived".

## What Changes

- In Date and None grouping a session with no known activity time ranks OLDEST
  (the "Older" bucket, after every timestamped session) instead of newest.
- Archiving a session (row/header action, ⌘W, or auto-archive) drops it from the
  pinned list, so it lands under "Archived".

## Capabilities

- `agent-roster-display` (MODIFIED)
