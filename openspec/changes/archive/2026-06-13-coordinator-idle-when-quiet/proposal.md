## Why

The per-project coordinator **always looks like it's running** — a flashing blue
in-flight dot — even when it has finished its turn and is sitting idle at its
prompt. The cause is in `rowFor` (`src/lib/overview/roster.ts`): a live, engaged
coordinator's status is a hard binary — `waiting` (Needs you) when it explicitly
asks, otherwise an unconditional `working`. Once it has been prompted at least
once, with no pending `AskUserQuestion` and no `request_user_input` flag, it is
forced to `working` forever, which maps to the `flight` lane → the `b-flight`
badge → the perpetual `flightflash` animation.

This was deliberate (suppress the default idle/waiting heuristic so a quiet,
orchestrating coordinator does not nag from the Needs-you lane), but it overshot:
instead of "quiet but not nagging," the coordinator became "permanently busy." It
never consults the real activity signal that every non-coordinator pane already
uses — recent PTY output (`runtime.lastOutputAt` via `deriveStatus`) and the
terminal-busy affordance (`runtime.terminalBusyAt` from `detectTerminalBusy`:
"esc to interrupt" / "Waiting for N dynamic workflow(s)"). `TerminalPane` stamps
both for the coordinator pane too, so the signal is available and ignored.

## What Changes

- A live, engaged coordinator (already prompted, no pending question, no
  `request_user_input` flag) now reflects its **real activity** instead of always
  reading `working`:
  - **Working** (flashing blue dot) only while actually running — streaming
    output within the working window, or a terminal-busy affordance observed
    within the busy grace window.
  - **Idle** (a new live state) when genuinely quiet at its prompt: it leaves
    the in-flight presentation and shows **no status dot**, while staying **out
    of the Needs-you/attention lane** (it never nags).
- The roster row's in-flight dot no longer renders for an `idle` row: the dot
  shows only for a row that needs attention (orange) or is actively `working`
  (flashing blue). (Side effect, intended: a not-yet-wired pane — `idle` from a
  missing runtime — likewise shows no dot rather than a misleading flash.)
- Unchanged: a freshly-launched coordinator that has never been prompted still
  reads `waiting` (awaiting your first instruction); a coordinator that asks an
  `AskUserQuestion` or sets the `request_user_input` flag still reads `waiting`
  (Needs you, orange dot). The general terminal-busy override for non-coordinator
  panes is untouched, as is the `request_user_input` flag lifecycle.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `agent-status-derivation`: MODIFY the "A freshly launched coordinator reads
  Waiting, not Working" requirement so an engaged-but-quiet coordinator reads
  **Idle** (no in-flight dot, out of attention) rather than Working, and reads
  Working only while actually running (recent output or a live busy affordance).

## Impact

- `src/lib/overview/roster.ts` — coordinator status branch in `rowFor`.
- `src/lib/overview/Inbox.svelte` — in-flight dot render condition.
- `src/lib/overview/roster.test.ts` — coordinator status scenarios.
- No change to the `request_user_input` flag set/clear lifecycle, the freshly-
  launched waiting case, or the non-coordinator terminal-busy override.
