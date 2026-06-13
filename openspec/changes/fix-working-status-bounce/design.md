## Context

Roster status for a live, non-coordinator agent is `liveEventStatus ?? ptyStatus`
(`roster.ts` `rowFor`). When the event-sourced status is `null` — no event pipeline,
or a transient gap such as a `SubagentStop` with no tool in flight — the status falls
through to `deriveStatus()`, which classifies purely on terminal silence:

```
nowMs - lastOutputAt <= WORKING_WINDOW_MS (2500ms) ? 'working' : 'waiting'
```

A working-but-quiet agent (thinking, or a long non-streaming tool) crosses that 2.5s
boundary on every quiet stretch, so its status oscillates `working ↔ waiting`. The
`terminalBusy` override (`roster.ts:563`) is supposed to pin it `working`, but it is a
40-line text scan refreshed only on PTY data, so it misses cases. The roster recomputes
every ~1s in `Inbox.svelte` from a fresh `runtimeMap()` snapshot; `buildRoster` and
`deriveStatus` are pure functions of their inputs, and the per-pane **runtime registry**
(`runtime.ts`) is the established mutable side-channel for live PTY state.

## Goals / Non-Goals

**Goals:**
- A live, non-coordinator agent shown as **working** does not bounce to **Needs you**
  on a brief silence — it holds working through silence up to a longer idle-grace
  window before demoting.
- Promotion to working stays responsive (output within the existing 2.5s window).
- Positive waiting signals (event-sourced `waiting`/`finished`, pending question,
  process exit) still resolve immediately — hysteresis governs only the
  silence-driven `working → waiting` transition.
- `buildRoster` / `deriveStatus` remain pure; hysteresis memory lives in the runtime
  registry, consistent with the existing architecture.

**Non-Goals:**
- Reworking or widening the `terminalBusy` override (left as-is; secondary).
- Changing coordinator status derivation, the event pipeline, or
  `deriveEventActivity`.
- Eliminating the Needs-you indication for a genuinely idle agent — after the
  idle-grace window of true silence, a no-event/null-gap agent still reads Needs you.

## Decisions

### Hysteresis via two thresholds + prior status

`deriveStatus` gains an optional `prevStatus` parameter and a second threshold
`IDLE_GRACE_MS` (10000ms). The silence-driven branch becomes:

```
const silent = nowMs - lastOutputAt;
if (silent <= WORKING_WINDOW_MS) return 'working';          // responsive promote
if (prevStatus === 'working' && silent <= IDLE_GRACE_MS)    // hysteresis hold
  return 'working';
return 'waiting';                                            // confirmed idle
```

- Output within 2.5s → working (unchanged promote behavior).
- 2.5s–10s silence: a pane that was **working** stays working; a pane that was
  **waiting** stays waiting (`prevStatus !== 'working'` → `waiting`) — so a settled
  idle pane is not spuriously re-promoted.
- >10s silence → waiting regardless. Any new output resets `lastOutputAt`, so
  re-promotion is immediate.

This kills the every-few-seconds bounce (an agent producing output at least every 10s
never demotes) while still surfacing genuine idle after one confirmed 10s gap, not a
sustained oscillation.

**Alternative considered — single larger flat window** (just raise 2.5s → 10s for
everyone): rejected because it equally delays the *first* legitimate Needs-you by 10s
for every idle session and still bounces for agents quiet 10–13s; hysteresis ties the
hold to "was already working," which is the actual signal.

**Alternative considered — never demote on silence alone** (require a positive
waiting signal): rejected for no-event-pipeline terminals, which have no positive
signal and would read working forever.

### Prior status stored in the runtime registry

`PaneRuntime` gains `lastStatus?: AgentStatus`. `runtime.ts` adds
`noteStatus(paneId, status)`. After each ~1s roster rebuild, `Inbox.svelte` writes each
row's final status back via `noteStatus`. `runtimeMap()` already shallow-copies entries,
so the snapshot fed to the next `buildRoster` carries `lastStatus`; `rowFor` passes it
into `deriveStatus` as `prevStatus`.

The recorded prior is the **final row status** (after coordinator / terminalBusy
overrides), so hysteresis reflects what the user actually saw, not the raw PTY value.
Coordinators are forced `working`/`waiting` by their own path and never reach the
`prevStatus` branch, so recording their status is harmless.

**Fail-safe:** with no `lastStatus` recorded (first tick, or a fresh pane),
`prevStatus` is `undefined`, the hysteresis branch is skipped, and the result is
byte-for-byte the current single-window derivation.

## Risks / Trade-offs

- [A genuinely-idle no-event session now takes ~10s instead of ~2.5s to read Needs
  you] → Acceptable and intended: event-sourced sessions still get immediate `waiting`
  from their Stop/Notification event (the common path); only the rarer PTY-only/null-gap
  case waits the extra grace. The user explicitly chose the ~8–10s window.
- [An agent thinking silently for >10s still flips to Needs you once] → A single late
  flip, not a sustained bounce — a large improvement over the status quo. Further
  tightening would need a positive "still working" signal, out of scope here.
- [Threading prior status couples `buildRoster` to a post-build write in `Inbox`] →
  Contained: the write is one `noteStatus` per row on the existing heartbeat; if the
  write is ever skipped, `prevStatus` is just absent and derivation falls back to the
  safe single-window path.
