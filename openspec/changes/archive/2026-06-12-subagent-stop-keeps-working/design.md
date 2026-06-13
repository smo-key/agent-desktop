## Context

The overview derives each agent's status from event hooks, falling back to a PTY-byte
heuristic. For a LIVE agent the roster uses `liveEventStatus ?? ptyStatus`
(`roster.ts`): the event-sourced status takes precedence over the live terminal
signal. That precedence is deliberate — an idle Claude TUI keeps redrawing (cursor
blink, status line), so raw PTY bytes cannot distinguish "idle redraw" from "real
work"; a prior fix (`f7c5d00`) made an idle session a STABLE `waiting` by letting the
event status pin it.

`deriveEventActivity` (`events.ts`) classifies the event stream. It tracks an
in-flight tool (a `PreToolUse` cleared by its `PostToolUse` or a turn boundary) and,
when no tool is in flight, maps the most recent event to a status. Today
`SubagentStop` is in BOTH the in-flight-clearing set and the `waiting` last-event
mapping.

A pane is one `claude` process. In-process Task subagents do NOT get their own pane —
they run inside the host session, which is where the `SubagentStop` hook fires. A
separate/specialist agent is its own `claude` process and ends its turn with `Stop`,
never `SubagentStop`. So on a pane, `SubagentStop` only ever means "a Task subagent
finished, the parent is still mid-turn" — never "this session returned to you."

## Goals / Non-Goals

**Goals:**
- A parent agent stays In flight (`working`) while an in-process Task subagent
  finishes; it returns to the awaiting-you state only on its own `Stop`.
- Preserve every other status behavior byte-for-byte: event-vs-PTY precedence, the
  idle-session `waiting` stability, the `terminalBusy` backstop, coordinator
  suppression, and the `Stop` / `Notification` / `SessionStart` mappings.

**Non-Goals:**
- The post-`Stop` / event-delivery latency window before a new turn's first event is
  ingested. Addressing it safely needs a sharper "work resumed" signal than raw PTY
  (which would regress the idle-flicker fix), so it is out of scope here.

## Decisions

- **Treat `SubagentStop` as a non-terminal continuation for the host pane.** Remove it
  from the in-flight-clearing switch and from the `waiting` last-event mapping in
  `deriveEventActivity`. The parent's status is then governed by its in-flight `Task`
  (`working`) and its own `Stop` (turn end) — which is the truth.
  - *Why not "prefer `working` whenever the PTY is active"?* That overrides the event
    status with raw PTY bytes, which an idle TUI also produces — it would re-introduce
    the working↔waiting flicker `f7c5d00` fixed. Rejected.
  - *Why not special-case "`SubagentStop` only clears in-flight when the tool is a
    subagent's own"?* The host pane never has a non-Task tool that a `SubagentStop`
    legitimately ends — so the simpler, fully-correct rule is to make `SubagentStop`
    inert for the host pane's status entirely.
- **Keep `SubagentStop` in `impliesEverPrompted`.** A subagent could only run after the
  session was prompted, so it still proves "has begun a turn" (the coordinator
  never-prompted heuristic must not regress).

## Risks / Trade-offs

- [A pane whose last event is `SubagentStop` with NO in-flight tool now falls through to
  the PTY-heuristic fallback instead of a fixed `waiting`.] → In practice the parent's
  `Task` `PreToolUse` is in flight whenever its subagent stops, so it stays `working`
  via the in-flight branch; the no-in-flight case is degenerate and the PTY fallback is
  a safe, already-used default. Covered by a unit test.
- [Hidden assumption that specialist/separate agents never emit `SubagentStop` on their
  own pane.] → They are independent `claude` processes that end with `Stop`; the orchestration
  model spawns them as panes, not in-process Tasks. Asserted in the design and guarded
  by keeping `Stop` handling unchanged.
