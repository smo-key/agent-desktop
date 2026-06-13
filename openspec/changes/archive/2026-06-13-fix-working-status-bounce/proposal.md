## Why

A live agent that is still working frequently flips to **Needs you** for a moment
and then back to **In flight** — the user notices it right after clicking the row.
The cause is the PTY-fallback status heuristic: when the event-sourced status is
unavailable (no event pipeline, or a transient null gap such as just after a
`SubagentStop`), status is derived purely from terminal silence, and **>2.5s of
silence is treated as "needs you."** A working agent that is thinking or running a
long, non-streaming tool trips this on every quiet stretch, so its status bounces
`working → waiting → working`. The `terminalBusy` override meant to hold it is too
fragile (a 40-line text scan, refreshed only on PTY data) to catch every case.

## What Changes

- Add **demotion hysteresis** to the PTY-fallback status derivation
  (`deriveStatus`): promotion to **working** stays responsive (terminal output
  within the existing 2.5s window), but an agent **already shown as working** holds
  that status through silence up to a longer **idle-grace window** (~10s) before
  demoting to **waiting** (Needs you). Below 2.5s → working; between 2.5s and the
  idle-grace window, a previously-working pane stays working; only past the
  idle-grace window does silence alone demote it.
- This applies to **all live non-coordinator panes** that fall through to the PTY
  heuristic — both no-event-pipeline terminals and event-pipeline sessions in a
  transient null-status gap. Coordinator derivation is untouched.
- Positive waiting signals are **unaffected**: a pending `AskUserQuestion`, an
  event-sourced `waiting`/`finished` (Stop / Notification / SessionEnd), or a
  process exit still resolve immediately — hysteresis only governs the
  silence-driven `working → waiting` transition.
- The roster threads each pane's **previously-derived status** into the next
  derivation (a small mutable field on the per-pane runtime registry) so the
  hysteresis band knows which side it was on; `buildRoster`/`deriveStatus` stay
  pure functions of their inputs.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `agent-status-derivation`: add a requirement that silence alone does not bounce a
  live, working, non-coordinator agent to Needs input — demotion requires a longer
  confirmed-idle window (hysteresis), while promotion and positive waiting signals
  stay immediate.

## Impact

- `src/lib/overview/roster.ts` — `deriveStatus` (hysteresis band + new idle-grace
  threshold constant), `rowFor`/`buildRoster` (thread prior status through).
- `src/lib/overview/runtime.ts` — store the last-derived status per pane
  (`noteStatus` / `lastStatus`) as the hysteresis memory.
- `src/lib/overview/Inbox.svelte` — record each row's derived status back to the
  runtime registry after each ~1s roster rebuild, closing the hysteresis loop.
- No change to the event pipeline, the `terminalBusy` override, or coordinator
  logic. Strictly additive and fail-safe: with no prior status recorded, behavior
  matches the current single-window derivation.
