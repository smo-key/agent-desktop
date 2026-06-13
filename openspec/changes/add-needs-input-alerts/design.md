## Context

The overview/inbox surface (`Inbox.svelte`) recomputes a pure roster of `AgentRow`
once per second via `buildRoster(...)`. An agent's need for the user is already
captured by `needsAttention(row)` in `src/lib/overview/roster.ts` — true when a
live (non-paused, non-archived) agent is `waiting` (quiet at its prompt) or
`error`. This predicate already suppresses a busy coordinator, so it is the right
and only trigger source; this change adds **no** new "needs you" logic.

The app has two top-level views (`view.svelte.ts`): `overview` ("mission control",
the inbox) and `grid` (the terminal tiling). The agent you are "viewing" is the
inbox focus agent in overview, or the active pane (`workspace.focusedId`) in grid.
There is no OS-window-focus listener today.

Settings are stored as keyed slices of one opaque `settings.json` blob via
`saveSettingsSlice` (merge-safe). Reactive settings stores follow a fixed shape
(see `autoAdvance.svelte.ts`): a `$state` prefs object, a pure `parse*Prefs`
validator, `load()`, and a setter that persists its slice.

The codebase strongly favors **pure, framework-free cores** (`roster.ts`,
`inbox.ts`) with thin reactive Svelte shells, and unit-tests the cores
exhaustively. This design mirrors that split.

## Goals / Non-Goals

**Goals:**
- Fire a sound and/or an OS desktop notification the instant an agent enters
  "Needs input", each channel independently configurable.
- Per-channel alert mode: `off` / `app-unfocused` / `agent-unfocused` / `always`.
- Edge-triggered: exactly once per entry into attention; no repeat while waiting.
- No alerts for agents already waiting at app launch.
- Silent, opt-in defaults (both channels `off`).
- Keep `Inbox.svelte` (already ~1530 lines) from growing materially: all logic in
  new, separately-tested modules; the component gets a single hook.

**Non-Goals:**
- Per-agent or per-project alert rules.
- Click-the-notification-to-focus-the-agent (possible later via the plugin's
  action events).
- User-selectable/custom sounds or volume control.
- A time-based cooldown/debounce (the edge detector fires once per entry; a quiet
  prompt produces no PTY output, so `waiting` does not flap).
- Changing any existing status-derivation, roster, or inbox-advance behavior.

## Decisions

### D1 — Trigger: reuse `needsAttention`, edge-detect on the attention set
A pure `notify.ts` keeps the **previous** set of attention paneIds. Each recompute,
`newlyNeedsAttention(prev, rows)` returns rows whose paneId is in the current
attention set but was not in `prev`. The reactive shell then replaces `prev` with
the current set. This yields exactly one alert per entry. *Alternative — comparing
prev/next status per row (like `shouldClearPin`):* rejected because a set-diff over
the whole roster is simpler, handles agents appearing/disappearing, and needs no
per-row previous-status bookkeeping.

### D2 — Prime through a startup settle window
The pure core primes on `prev === null` (first observation fires nothing). But the
always-mounted driver's first ticks run BEFORE `restorePersistedLayout()` resolves,
against an EMPTY roster — and panes re-spawn / snapshots+events seed asynchronously
after `restored` flips, so a resumed session re-derives its quiet "waiting" prompt
*seconds* into launch. Priming once on the empty roster would therefore let every
restored waiter look "fresh" and alert. So the driver stays in **prime mode** —
calling `controller.prime(rows)` each tick (track the baseline, fire nothing) — until
the app is SETTLED: `restored && notifications.loaded` AND a short grace
(`ALERT_SETTLE_MS`, ~6s) has elapsed. Only after that does it `process(...)`. This
folds launch-time and resume-settling waiters into the baseline; only genuinely new
entries after settling alert. (The grace suppresses a real new alert only in the
first few seconds of launch, when the user is necessarily looking at the app.)

### D3 — Per-channel mode is the single control (no separate enable flag)
Each channel's mode includes `off`, so `mode` *is* the enable switch. Prefs shape:
```ts
type AlertMode = 'off' | 'app-unfocused' | 'agent-unfocused' | 'always';
interface NotificationPrefs { sound: { mode: AlertMode }; desktop: { mode: AlertMode }; }
```
`shouldAlert(row, mode, ctx)` with `ctx = { appFocused, viewedPaneId }`:
- `off` → false
- `always` → true
- `app-unfocused` → `!appFocused`
- `agent-unfocused` → `!(appFocused && viewedPaneId === row.paneId)`

This is a monotonic ladder (each mode alerts at least as often as the previous).
The shell evaluates it once per channel per newly-attention row, so sound and
desktop are fully independent. *Alternative — one shared mode + two booleans:*
rejected per the user's explicit choice of separate modes; folding `off` into the
mode also removes a redundant on/off axis.

### D4 — Focus decision is taken at the entry edge, not on focus changes
`shouldAlert` is evaluated only for rows that *just* entered attention, using the
focus context at that instant. Tabbing away later, while an agent stays waiting,
does not retroactively alert. This keeps alerts tied to the agent's state change
(the meaningful event) rather than the user's window focus, avoiding surprise pings
on every blur. Re-entry (waiting→working→waiting) is a fresh edge and alerts again.

### D5 — Desktop notifications via the Tauri notification plugin
Add `@tauri-apps/plugin-notification` + `tauri-plugin-notification`, registered in
`lib.rs`, with `notification:default` granted in `capabilities/default.json`. The
shell checks/asks permission (`isPermissionGranted` / `requestPermission`) when the
desktop channel is set to non-`off`, then `sendNotification({ title, body })` with
title "Agent needs input" and body = agent name + its pending question or last
message (clipped). *Alternative — web `Notification` API:* rejected; unreliable in
the Tauri webview and no macOS permission integration. In a non-Tauri/web context
(`dev:web`) the invoke fails harmlessly and is swallowed.

### D6 — Sound via runtime-synthesized WebAudio chime
`playChime()` creates a short two-tone ding with an `AudioContext`/oscillator,
constructed lazily and resumed on first use. *Alternative — bundle an audio file in
`static/`:* rejected to avoid committing/maintaining a binary asset; synthesis is a
few lines, has no asset-path/CSP concerns, and plays whether or not the app is
focused. The webview keeps running in the background, so background chimes work.

### D7 — OS window focus as its own tiny reactive store
`windowFocus.svelte.ts` exposes `appFocused` derived from `window` `focus`/`blur`
and `document.visibilitychange` (focused = has focus AND visible). Isolated so the
pure core stays free of browser globals and the value is mockable.

### D7b — Drive alerts from the always-mounted route, not the Inbox
`Inbox.svelte` is mounted **only in overview mode** (`{#if view.isOverview}` in
`+page.svelte`); the grid view is kept mounted-but-hidden. So the alert driver
must NOT live in the Inbox — it would go silent the moment the user digs into an
agent (grid view), then burst-fire stale alerts on return. Instead the always-
mounted route `+page.svelte` owns the alert `$effect`: it builds the roster via
`buildRoster(...)` off the same module singletons the Inbox uses (snapshots,
workspace, runtime registry, activity, events, coordinator-needs-input) on its own
1s clock, and calls `alerts.process(rows, ctx)`. The `alerts` controller is driven
from this single place, so there is no double-firing. `viewedPaneId` is
`view.isGrid ? workspace.focusedPaneId : focusAgent.paneId` — note `focusedPaneId`
(the focused leaf's PANE id), NOT `focusedId` (the leaf/node id), so the
`agent-unfocused` comparison `viewedPaneId === row.paneId` actually matches in grid
view. The route also mirrors the Inbox's coordinator `clearOnWorking` so a
coordinator's needs-input flag still clears while the user is in grid view.

### D7c — `focusAgent` store publishes the inbox's shown agent
The overview's "currently viewed" agent is the inbox focus pane's agent, which is
`Inbox.svelte`-local state. A tiny `focusAgent.svelte.ts` singleton holds that
paneId; the Inbox publishes its shown agent into it via one `$effect`, and the
route's alert driver reads it for the overview-mode `viewedPaneId` (grid mode reads
`workspace.focusedId` directly). This is the Inbox's ONLY change — it does not grow.

### D8 — Module boundaries
- `notify.ts` (pure): `newlyNeedsAttention`, `shouldAlert`, the `AlertMode` type.
  No Svelte/Tauri/browser imports. Exhaustively unit-tested.
- `notifications.svelte.ts` (settings store): `NotificationPrefs`,
  `DEFAULT_NOTIFICATION_PREFS` (both `off`), pure `parseNotificationPrefs`,
  `load()`, `setSoundMode`/`setDesktopMode`, persists the `notifications` slice.
- `windowFocus.svelte.ts`: `appFocused` reactive store.
- `focusAgent.svelte.ts`: a one-field reactive singleton holding the inbox's
  currently-shown agent paneId (published by the Inbox, read by the route driver).
- `alerts.svelte.ts` (reactive shell): holds `prev`/primed state, reads prefs +
  focus + `viewedPaneId`, calls the pure core, performs side effects (permission,
  `sendNotification`, `playChime`). Exposes a single `process(rows, ctx)`.
- `+page.svelte` (always-mounted route): builds the alert roster off the shared
  singletons on a 1s clock and calls `alerts.process(...)` (see D7b); starts the
  `windowFocus` listeners.
- `Inbox.svelte`: one `$effect` publishing its shown agent into `focusAgent`.
- `SettingsModal.svelte`: a "Notifications" section with two mode pickers.

## Risks / Trade-offs

- **`waiting` flap spamming alerts** → Mitigated by the existing status model: a
  quiet prompt emits no PTY output so it stays `waiting` continuously (no edge);
  `terminalBusy` and event-sourced status already keep long in-progress work
  `working`. Edge-only firing means at most one alert per genuine entry. No
  cooldown needed (Non-Goal); revisit only if real flapping is observed.
- **macOS notification permission denied** → The desktop channel silently no-ops
  when permission is not granted; the sound channel is unaffected. The Settings UI
  reflects a denied/blocked state so the user understands why nothing appears.
- **Non-Tauri (`dev:web`) context** → `sendNotification`/permission invokes throw;
  the shell swallows errors so the web preview still runs. WebAudio works in-browser.
- **"Viewing an agent" ambiguity in overview** → Defined precisely as the inbox
  focus agent (the big focus pane), not "any visible card", so `agent-unfocused`
  has one unambiguous target per view.
- **First-observation priming depends on the first roster being representative** →
  Acceptable: the first per-second tick already has the full restored roster; worst
  case a single agent that flips to waiting within the very first tick is treated as
  pre-existing and skipped once.
