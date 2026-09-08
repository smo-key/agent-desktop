# Add a Minimal sessions-panel density

## Why

Compact mode still shows two lines per session row. Users with many open
windows want the roster to read as a plain list of titles.

## What Changes

- The Settings "Sessions panel → Density" dropdown gains a third option,
  "Minimal", after "Default" and "Compact".
- Minimal rows keep only the session title beside a smaller project icon;
  the status sub-line and the context/model/time meta line are omitted.
- The persisted `compactMode` slice becomes `{ density }`; the legacy
  `{ enabled: true }` shape still reads as Compact.

## Capabilities

- `agent-roster-display` (MODIFIED)
