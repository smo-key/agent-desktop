## Context

`deriveStatus` reads `working` while `nowMs - runtime.lastOutputAt <=
WORKING_WINDOW_MS` (2500 ms). `lastOutputAt` is stamped by `noteOutput` on every
PTY `data` chunk (`TerminalPane.svelte` `channel.onmessage`). When a pane becomes
visible (workspace selected), the visible `$effect` runs `safeFit()`; a real
geometry change emits `onResize` → `pty_resize` (`TerminalPane.svelte:748`) →
SIGWINCH → Claude redraws → PTY output → `noteOutput` → the idle agent reads
`working` for ~2.5 s. The app *initiates* that resize, so it can mark it.

## Goals / Non-Goals

**Goals:** stop a self-initiated resize/redraw from promoting an idle agent to In
flight; keep genuinely-working agents and all other paths unchanged.

**Non-Goals:** the subagent in-flight-Task stickiness (separate change); changing
the resize itself (the reflow is legitimately needed when the size changes).

## Decisions

### D1 — Mark self-initiated resizes; ignore the redraw burst for the silence signal

`onResize` (the only place the app pushes `pty_resize`) records a per-pane
`resizeAt = now`. `noteOutput` ignores the `lastOutputAt` stamp for output that
arrives within `RESIZE_REDRAW_MS` of `resizeAt` — that output is the SIGWINCH
redraw, not work — **but only when the pane is otherwise idle** (`lastOutputAt`
already older than `WORKING_WINDOW_MS`). A genuinely working pane keeps stamping,
so even a storm of resizes (a drag continuously re-arming `resizeAt`) can never
freeze its `lastOutputAt` and demote it; the suppression strictly targets the
idle-select flash. Output outside the window stamps normally.

- The redraw arrives asynchronously (invoke → Rust → ioctl → SIGWINCH → redraw →
  channel), so a synchronous flag set in the effect would clear too early; a
  timestamp absorbs the round-trip latency.
- `noteOutput` still runs its alive-coherence (`exited`/`exitCode` reset); only the
  `lastOutputAt` advance is skipped within the window, so readiness/spinner
  consumers (handled separately in `TerminalPane`) are unaffected.

### D2 — `RESIZE_REDRAW_MS` well under `WORKING_WINDOW_MS`

Pick a window long enough to cover the resize round-trip + redraw (a few hundred
ms) but far below `WORKING_WINDOW_MS` (2500 ms), so a genuinely working agent that
happens to be resized is never demoted: its pre-resize `lastOutputAt` is still
fresh within the 2500 ms window, and its real output resumes stamping once the
short suppression lapses. `RESIZE_REDRAW_MS = 750`.

### D3 — `noteResize` never fabricates a runtime entry

Like `noteStatus`, `noteResize` records only when an entry already exists. An idle
agent has an entry (from prior output); a never-output pane derives `working`
(just spawned) regardless, so resize suppression is moot for it.

## Risks / Trade-offs

- [A user resizes (or storm-resizes via a drag) a genuinely working agent] → No
  suppression at all: the idle-only guard means a pane with recent output keeps
  stamping `lastOutputAt`, so its working status is never frozen or demoted by any
  number of resizes. Suppression applies only to a pane already past the working
  window (idle), which is exactly the idle-select case.
- [A resize that produces NO output] → `resizeAt` is set but there is nothing to
  suppress; the next real output (outside the window) stamps normally. Harmless.

## Migration Plan

In-memory runtime state only; additive optional `resizeAt` field. Rollback is
reverting the diff.

## Open Questions

None.
