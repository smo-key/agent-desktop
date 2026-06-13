## Why

When an agent surfaces a "needs input" desktop notification, the user has no
direct way to act on it: clicking the notification does nothing, so they must
manually find the app, raise its window, and hunt for the right agent in the
roster. The alert points at a specific agent — the click should take you
straight to it.

## What Changes

- Clicking a "needs input" desktop notification **raises and focuses the
  Mission Control window** and **selects the alerting agent** in the overview.
- If the agent's session has ended by the time the notification is clicked
  (its pane no longer exists), the click **only focuses the window** and makes
  no selection.
- Because the stock Tauri notification plugin discards click events on desktop,
  notifications on **macOS** are sent through a new custom Rust path
  (`mac-notification-sys`) that captures the body click and emits a
  `paneId`-carrying event to the renderer. **Non-macOS platforms keep today's
  behavior** (notifications still fire, but are not clickable).
- New window permissions (`set-focus`, `unminimize`, `show`) are granted so the
  renderer can bring the window forward.

## Capabilities

### New Capabilities
- `alert-click-focus`: Activating an agent's needs-input desktop notification
  brings the app forward and focuses that agent (or just the window when the
  agent is gone); macOS delivers the click via a custom notification path.

### Modified Capabilities
<!-- None. The needs-input-alerts capability is not yet in durable specs (its
     change is unarchived), so click-to-focus is captured as its own new
     capability rather than a delta. -->

## Impact

- **Renderer**: `src/lib/overview/alerts.svelte.ts` (send path), the
  always-mounted route `src/routes/+page.svelte` (activation listener +
  window focus + agent selection), `src/lib/overview/view.svelte` and the
  inbox (`src/lib/overview/Inbox.svelte`) for an inbound "select this paneId"
  channel, reusing the existing `navigateTarget` path.
- **Rust (`src-tauri`)**: new `notify_agent` command + `agent-notification-activated`
  event; add `mac-notification-sys` as a direct dependency (already present
  transitively). macOS-gated.
- **Capabilities**: `src-tauri/capabilities/default.json` gains
  `core:window:allow-set-focus`, `allow-unminimize`, `allow-show`.
- **Platform**: macOS only for click handling; verifiable only in a bundled,
  signed build (consistent with the existing LIVE/MANUAL alerts module).
