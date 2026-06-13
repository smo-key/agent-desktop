## Context

The needs-input alerts capability fires a native desktop notification when an
agent newly enters "Needs input" (`src/lib/overview/alerts.svelte.ts`,
`desktopNotify`). Today that notification is inert: clicking it does nothing.

The obvious implementation — attach a JS click handler via the notification
plugin — is **not possible**. The installed `@tauri-apps/plugin-notification`
(2.3.3) only emits `onAction` / `onNotificationReceived` on **mobile**. Its
desktop path (`desktop.rs`) calls `notify_rust`'s `show()` in a spawned task and
discards the result, so on macOS no click event ever reaches JS.

The capability does exist one layer down: `notify_rust` wraps
`mac-notification-sys` on macOS, whose `Notification::new().wait_for_click(true)`
blocks and returns `NotificationResponse::Click` on a body tap. The plugin just
throws that response away. We can call that crate directly from our own command.

Agent selection already has a clean, tested core: `navigateTarget(workspaces,
paneId)` → `{workspaceId, leafId}`, which the inbox uses today
(`Inbox.svelte` → `setActiveWorkspace` + `setFocusIn`). The inbox owns selection
as local state (`shownId` / `selectAgent`); there is currently **no inbound
channel** for an external trigger to command "select this paneId".

## Goals / Non-Goals

**Goals:**
- Clicking a needs-input notification raises/focuses the Mission Control window
  and selects the alerting agent in the overview.
- A clicked notification whose agent has ended focuses the window only (no
  selection), per product decision.
- Reuse the existing `navigateTarget` selection path rather than inventing a
  parallel one.

**Non-Goals:**
- Click handling on Windows/Linux. Those keep the current plugin send path
  (notifications fire, but are not clickable). The custom path is macOS-gated.
- Action buttons / reply fields on the notification. Body click only.
- Reworking the alerts decision core (`notify.ts`) or the sound channel.
- Headless/automated coverage of the OS notification round-trip (LIVE/MANUAL,
  consistent with the existing alerts module).

## Decisions

### D1 — Custom macOS Rust notification path instead of the JS plugin
On macOS, `desktopNotify` invokes a new Tauri command `notify_agent({ paneId,
title, body })` rather than the plugin's `sendNotification`. The command sends
via `mac-notification-sys` with `wait_for_click(true)` on a blocking thread and,
on `NotificationResponse::Click`, emits a Tauri event
`agent-notification-activated` with `{ paneId }`.

*Alternatives considered:* (a) the stock plugin's `onAction` — impossible on
desktop (discarded). (b) Patching/forking the plugin — heavier and harder to
maintain than a small dedicated command. (c) Relying on macOS auto-activating
the app on click — only focuses the window in a bundled build and cannot select
the specific agent.

*Concurrency:* `mac-notification-sys` 0.6.14 keys each pending notification by a
UUID `PendingEntry`, so several agents alerting at once is safe. Each pending
notification parks one thread until interaction/dismissal — acceptable at our
volume.

### D2 — `paneId` rides on the notification, recovered on click
The roster row's `paneId` (the snapshot key, already unique per leaf) is passed
into `notify_agent` and echoed back in the event payload. This is the single
identifier the existing `navigateTarget` already consumes.

### D3 — Inbound selection channel: a one-field request store
A new singleton (mirroring the existing `focusAgent` store) holds a
"requested paneId + nonce". The always-mounted route writes it from the event
listener; `Inbox.svelte` observes it and routes through its existing
`selectAgent`. The nonce lets the same agent be re-requested (repeat clicks).
The route also calls `view.show('overview')` so the inbox is mounted to receive
it. This keeps the route out of the inbox's internals, symmetric with how
`focusAgent` already flows the other direction.

### D4 — Window focus from the renderer
The event listener raises the window via `@tauri-apps/api/window`
`getCurrentWindow().show()` → `unminimize()` → `setFocus()`. This needs new
capabilities: `core:window:allow-set-focus`, `allow-unminimize`, `allow-show`
in `capabilities/default.json`.

### D5 — Dead-pane handling is a renderer-side no-op
If the requested `paneId` is not carried by any live leaf (`navigateTarget`
returns null / the roster has no such row), the inbox makes no selection; the
window has already been focused. No special signaling from Rust is needed.

### D6 — Where the pure logic lives (for testability)
The event→intent mapping is extracted into a small pure function (input: event
payload + current roster/workspaces; output: `{ focusWindow: true, selectPaneId:
string | null }`) so the "select live agent" vs "dead-pane focus-only" branch is
unit-tested without a window. The window focus + Tauri `listen`/`invoke` calls
remain LIVE/MANUAL.

## Risks / Trade-offs

- **Click events require a bundled, signed `.app`** → `mac-notification-sys`
  delivery + click response generally do not work under `tauri dev` (the stock
  plugin even reroutes dev notifications through `com.apple.Terminal`). →
  Mitigation: verify in a release build; document the LIVE/MANUAL nature in the
  tasks and spec scenarios; keep behavior a graceful no-op when the round-trip
  is unavailable.
- **Two notification code paths** (custom macOS vs plugin elsewhere) →
  divergence risk. → Mitigation: macOS-gate at a single seam in `desktopNotify`;
  share the title/body builders (`notificationTitle`/`notificationBody`) across
  both.
- **Parked threads** for notifications the user never touches → resource use. →
  Mitigation: low alert volume; threads end when the OS dismisses the
  notification; revisit only if volume grows.
- **OS permission model differences** between the plugin's path and
  `mac-notification-sys` → a notification that silently fails to show. →
  Mitigation: keep the existing `ensureDesktopPermission` gate (same app-bundle
  grant) and swallow errors as the current code does.
- **Window-focus permissions widen capabilities** → minor surface increase. →
  Mitigation: add only the three window permissions needed; scoped to the
  `main` window.
