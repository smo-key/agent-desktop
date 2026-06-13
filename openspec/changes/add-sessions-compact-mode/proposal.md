## Why

Each sessions-panel roster row renders three lines: the title, the status
sub-line, and a third "meta" line carrying the context-window percent, the
model label, and the time since last activity. Users who keep many agents open
want a denser roster that fits more rows on screen; the meta line is the least
essential of the three for at-a-glance scanning.

## What Changes

- Add an opt-in **Compact mode** toggle in Settings (under a new "Sessions
  panel" group). When enabled, every roster row in the sessions panel (Inbox)
  **omits its third line** — the context/model/time meta line — leaving only the
  title and status sub-line.
- The preference defaults **OFF** (full three-line rows) and persists as the
  `compactMode` slice of the shared `settings.json`, loaded once on startup like
  the other settings stores.

## Capabilities

### Modified Capabilities
- `agent-roster-display`: Roster rows gain an opt-in compact mode that hides the
  third (context/model/time) line.

## Impact

- **Renderer**: new `src/lib/settings/compactMode.svelte.ts` store (+ tests),
  `src/lib/ui/SettingsModal.svelte` (toggle), `src/lib/overview/Inbox.svelte`
  (gate the `.meta` line), `src/routes/+page.svelte` (load on mount).
- **Persistence**: a new `compactMode` key in `settings.json`; no Rust changes.
