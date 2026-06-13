## Why

An agent that is actively working sometimes shows **Needs input** ("Needs You") in
the overview. The trigger is the `SubagentStop` hook: it fires on the PARENT
session's pane each time an in-process Task subagent finishes, and the roster's
event-sourced status treats it as a turn boundary — clearing the in-flight tool and
flipping the pane to `waiting`. But the parent's `Task` tool has not returned and the
parent is still working, so a busy agent is wrongly pulled into the attention lane
(and it re-fires for every subagent when Tasks run in parallel). This matches the
reported symptom: it happens "when tools are used, including after an agent sends a
response message."

## What Changes

- `deriveEventActivity` (event-sourced status) stops treating `SubagentStop` as a
  turn end for the host pane: it no longer clears the in-flight tool, and it no
  longer maps the pane to `waiting`. A parent agent therefore stays **In flight**
  (`working`) while its Task subagent finishes; the parent's real turn end remains
  the `Stop` event.
- No change to the event-vs-PTY precedence, the `terminalBusy` backstop, the
  coordinator suppression, or how `Stop` / `Notification` / `SessionStart` are
  classified — those stay exactly as they are (the idle-session `waiting` stability
  from the prior idle-flicker fix is preserved).

Out of scope (deliberately): the separate, smaller post-`Stop` / event-delivery
latency window before a new turn's first event lands. That is harder to confirm and
risks regressing the idle-flicker behavior, so it is not addressed here.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `agent-status-derivation`: a working parent agent is NOT shown Needs input when an
  in-process Task subagent finishes (`SubagentStop`); only the parent's own turn end
  (`Stop`) returns it to the awaiting-you state.

## Impact

- `src/lib/overview/events.ts` — `deriveEventActivity`: remove `SubagentStop` from the
  in-flight-clearing switch and from the `waiting` last-event mapping. `SubagentStop`
  remains in `impliesEverPrompted` (a running subagent still proves the session was
  prompted).
- Tests: `src/lib/overview/events.test.ts` (new failing case first, TDD). No change to
  `roster.ts` logic; existing `roster.test.ts` coverage continues to hold.
- Verification: unit tests only (the affected functions are pure and well-covered).
