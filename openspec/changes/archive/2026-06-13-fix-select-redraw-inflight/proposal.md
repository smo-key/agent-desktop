## Why

Selecting an **idle** agent in the overview briefly shows it as **In flight** for
~2.5 s, then it returns to Needs-you. Root cause: selecting navigates to the
agent's workspace, flipping its pane `visible`; the visible `$effect`
(`TerminalPane.svelte:857`) runs `safeFit()`, and a real geometry change emits
`onResize` → `pty_resize` → the PTY gets SIGWINCH and Claude **redraws its TUI**.
That redraw is PTY output, so `noteOutput` stamps `lastOutputAt` and
`deriveStatus` reads `working` for `WORKING_WINDOW_MS` (2500 ms). The "work" is an
artifact of the user merely looking at the session.

## What Changes

- A PTY output burst that is the **direct result of a resize/redraw we initiated**
  (a `pty_resize` round-trip, e.g. when a pane becomes visible) SHALL NOT promote
  an otherwise-idle agent to In flight. The status-relevant activity stamp ignores
  output that arrives within a short window after a self-initiated resize.
- Strictly additive and fail-safe: with no recent resize, activity tracking is
  exactly as before; a genuinely working agent (recent real output before the
  resize, an event-sourced `working`, or an active-work affordance) is unaffected.
- Out of scope: the subagent in-flight-Task stickiness (a separate issue — a
  parent awaiting a Task subagent is legitimately working; changing that risks
  hiding real subagent work and needs its own evidence-driven change).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `agent-status-derivation`: add that output caused solely by a self-initiated
  terminal resize/redraw (e.g. a pane becoming visible) does not count as
  work-activity for status, so selecting an idle agent does not read it as In
  flight.

## Impact

- Frontend:
  - `src/lib/overview/runtime.ts` — add `noteResize(paneId, nowMs)` recording the
    last self-initiated resize; `noteOutput` ignores the status stamp for output
    within `RESIZE_REDRAW_MS` of that resize. Add `resizeAt` to the runtime entry.
  - `src/lib/overview/roster.ts` — add `RESIZE_REDRAW_MS`; add `resizeAt` to
    `PaneRuntime`.
  - `src/lib/TerminalPane.svelte` — call `noteResize` in the `onResize` handler
    (alongside the `pty_resize` invoke).
- Tests: `runtime` `noteOutput` suppression within the resize window and normal
  stamping outside it; `noteResize` behavior.
