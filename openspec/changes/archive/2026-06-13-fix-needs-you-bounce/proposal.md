## Why

A genuinely-working agent can get **pinned in the Needs-you lane** and then **flip
rapidly between In-flight and Needs-you** as the session produces output. Root
cause: for a live non-coordinator agent the row is `liveEventStatus ?? ptyStatus`
with a `terminalBusy` override forcing In-flight. The event-sourced status is a
deliberately *stable* `waiting` after a turn-boundary hook (`Stop` /
`Notification` / `SessionStart`) and overrides live PTY output, so an agent that
is working but hasn't emitted an advancing hook event is pinned `waiting`. The
only thing that rescues it — the `terminalBusy` override — is a per-PTY-chunk
screen-scrape of a continuously-redrawing TUI spinner (`detectTerminalBusy` over
the last 40 lines), stored in a non-reactive map and **sampled once per second**
by the roster heartbeat. So while output flows the sampled indicator flickers →
~1 Hz In-flight↔Needs-you bounce; while output is quiet it sits at false → stuck
in the stale `waiting`. The existing `IDLE_GRACE_MS` hysteresis only damped the
opposite PTY-side working→waiting bounce and does not touch this interaction.

## What Changes

- Add **hysteresis to the active-work (terminalBusy) override**: once an
  active-work affordance is detected, the In-flight override SHALL hold for a
  short grace window after the affordance was *last* seen, instead of clearing on
  the first chunk/heartbeat that doesn't observe it. This rides through the
  spinner's redraw gaps and the 1 Hz sampling, eliminating the rapid bounce and
  the visible-while-working stickiness.
- Introduce a dedicated grace constant (~3s) — long enough to exceed the 1 s
  heartbeat and typical spinner-redraw gaps, short enough that a genuinely
  finished agent leaves In-flight promptly.
- Keep all existing override guards unchanged: a pending `AskUserQuestion` still
  reads Needs-you, coordinator derivation is untouched, and with no affordance
  ever seen the behavior is exactly as before (fail-safe).
- Out of scope: changing the event-vs-PTY precedence (the stable-`waiting`
  design) or promoting an agent that shows *no* active-work affordance at all —
  the surgical hysteresis fix is deliberately limited to the override that
  already exists.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `agent-status-derivation`: the "A busy session reads In flight, not Needs input"
  requirement is extended so the override is **held for a grace window after the
  active-work affordance was last detected**, rather than reflecting only the
  instantaneous (per-chunk, 1 Hz-sampled) detection — so a flickering or briefly-
  absent affordance does not bounce the agent between In-flight and Needs-you.

## Impact

- Frontend:
  - `src/lib/overview/runtime.ts` — `noteBusy` records the timestamp of the last
    positive detection (a `terminalBusyAt` on the runtime entry) rather than only
    a boolean; a negative detection no longer immediately clears the held state.
  - `src/lib/overview/roster.ts` — the `terminalBusy` override in `rowFor` becomes
    time-based: active when `now - terminalBusyAt <= BUSY_GRACE_MS`; add the
    `BUSY_GRACE_MS` constant next to `IDLE_GRACE_MS`.
  - `src/lib/TerminalPane.svelte` — `noteBusy` call passes the current time
    alongside the detection result.
- Tests: `rowFor`/derivation unit tests for the held override (held through a
  transient false within the window; cleared after the window; pending-question
  and coordinator guards still win); `runtime` `noteBusy` timestamp behavior.
