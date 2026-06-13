## Context

Status for a live, non-coordinator agent is computed in `rowFor`
(`src/lib/overview/roster.ts`): `status = liveEventStatus ?? ptyStatus`, then an
override forces `working` when `runtime.terminalBusy === true` (and there is no
pending question). `terminalBusy` is set by `noteBusy` (`runtime.ts`) on **every
PTY chunk** from `detectTerminalBusy(recentTerminalText())`
(`TerminalPane.svelte:584`) — a screen-scrape of the last 40 rendered lines for
the spinner affordance. The runtime registry is a plain non-reactive `Map`; the
roster rebuilds on a 1 s heartbeat (`Inbox.svelte:138`) and reads whatever
`terminalBusy` happens to be at that instant.

Because the affordance is part of a continuously-redrawing TUI line, the scraped
boolean is not stable frame-to-frame, and the 1 s sampling of it — against a
stale event-sourced `waiting` — yields a ~1 Hz In-flight↔Needs-you bounce; when
output stops, the boolean rests at `false` and the row is stuck in the stale
`waiting`.

## Goals / Non-Goals

**Goals:**
- Stop the In-flight↔Needs-you bounce for a live agent that is actively working.
- Stop the visible-while-working stickiness whenever a busy affordance appears
  even intermittently.
- Keep the change additive and fail-safe: no affordance ever seen ⇒ behavior
  byte-for-byte as before.

**Non-Goals:**
- Changing the event-vs-PTY precedence or the stable-`waiting` design.
- Promoting an agent that shows *no* active-work affordance at all (pure event
  staleness with no spinner) — explicitly deferred.
- Coordinator derivation (untouched) and the pending-question guard (untouched).

## Decisions

### D1 — Make the override time-held, keyed on the last positive detection

Replace the instantaneous boolean check with a freshness check: the override is
active when `nowMs - terminalBusyAt <= BUSY_GRACE_MS`, where `terminalBusyAt` is
the timestamp of the **last** `detectTerminalBusy === true`. A `false` detection
no longer clears anything; it simply stops refreshing `terminalBusyAt`, so the
override naturally lapses `BUSY_GRACE_MS` after the affordance truly disappears.

- This mirrors the existing silence demotion hysteresis (`IDLE_GRACE_MS` in
  `deriveStatus`): promotion stays instant (any positive detection re-arms the
  window immediately), demotion waits out a grace window.
- **Alternative — debounce/counter** (require N consecutive false detections):
  rejected. Detection cadence is tied to PTY chunk arrival, which is bursty and
  irregular, so a count is not a reliable proxy for elapsed time; a wall-clock
  window is.

### D2 — `noteBusy` records a timestamp, not a boolean

`noteBusy(paneId, busy, nowMs)`: when `busy` is true, set
`runtime.terminalBusyAt = nowMs`; when false, leave `terminalBusyAt` unchanged.
`TerminalPane.svelte` already has `Date.now()` at the call site (it passes it to
`noteOutput`), so the timestamp is free. The runtime entry keeps a single
`terminalBusyAt: number | null` field; the old boolean `terminalBusy` is removed
(or derived) so there is one source of truth.

- `rowFor` gains `nowMs` access (already a parameter) to evaluate the window.
- The override predicate: `runtime?.terminalBusyAt != null && nowMs -
  runtime.terminalBusyAt <= BUSY_GRACE_MS`.

### D3 — Dedicated `BUSY_GRACE_MS ≈ 3000`, beside `IDLE_GRACE_MS`

Chosen to exceed the 1 s heartbeat and typical spinner-redraw gaps while clearing
within a few seconds of work actually ending. Kept distinct from `IDLE_GRACE_MS`
(10 s) because the two windows answer different questions (silence-demotion of a
PTY-derived working state vs. lapse of a positively-detected busy affordance), and
10 s would make a finished agent linger In-flight too long.

## Risks / Trade-offs

- [A finished foreground command lingers In-flight for up to ~3 s] → Acceptable:
  far better than the bounce, and short enough to feel responsive. The scenario
  "status returns to normal when the command ends" is updated to allow the grace
  window.
- [Pure event-staleness with no affordance is still sticky] → Knowingly out of
  scope (D-Non-Goals); the dominant user-visible artifacts (bounce + stickiness
  during active output) are fixed. Captured for a possible follow-up.
- [Stale `terminalBusyAt` after a pane goes quiet then exits] → Exit is
  authoritative in `deriveStatus`/`rowFor` (a dead process is never working), and
  closed/coordinator/pending-question guards run regardless of the window, so a
  held timestamp cannot resurrect a finished/closed/asking agent.

## Migration Plan

Pure in-memory runtime state; no persistence, no schema. Rolling back is reverting
the diff. The field rename (`terminalBusy` → `terminalBusyAt`) is internal to the
runtime registry and its readers.

## Open Questions

None — scope (hysteresis only) and window (~3 s dedicated constant) settled in the
interview.
