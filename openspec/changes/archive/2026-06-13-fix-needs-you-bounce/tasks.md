# Tasks

## 1. Runtime — record last-busy timestamp

- [x] 1.1 In `src/lib/overview/roster.ts`, replace the `PaneRuntime.terminalBusy?: boolean` field with `terminalBusyAt?: number | null` (unix ms of the last positive active-work detection), updating the doc comment.
- [x] 1.2 In `src/lib/overview/runtime.ts`, change `noteBusy(paneId, busy)` to `noteBusy(paneId, busy, nowMs)`: when `busy` is true set `terminalBusyAt = nowMs`; when false, leave `terminalBusyAt` unchanged (a negative detection never clears the held state).

## 2. Derivation — hold the override for a grace window

- [x] 2.1 In `src/lib/overview/roster.ts`, add `export const BUSY_GRACE_MS = 3000;` beside `IDLE_GRACE_MS`, with a comment explaining it must exceed the 1 s heartbeat and typical spinner-redraw gaps while clearing promptly when work ends.
- [x] 2.2 In `rowFor`, change the active-work override from `runtime?.terminalBusy === true` to a freshness check: `runtime?.terminalBusyAt != null && nowMs - runtime.terminalBusyAt <= BUSY_GRACE_MS`. Keep all existing guards (no pending question, not coordinator, not closed/exited) exactly as before.

## 3. Call site

- [x] 3.1 In `src/lib/TerminalPane.svelte`, update the `noteBusy(paneId, detectTerminalBusy(recentTerminalText()))` call to pass the current time (`Date.now()`), matching the `noteOutput` call alongside it.

## 4. Tests

- [x] 4.1 Unit-test `rowFor` (or the derivation): a stale event `waiting` + a `terminalBusyAt` within `BUSY_GRACE_MS` reads In flight; a single intervening tick where the timestamp is NOT refreshed but is still within the window stays In flight (no bounce); past the window with no refresh it returns to the event-derived status.
- [x] 4.2 Unit-test that the held override never overrides the guards: a pending AskUserQuestion reads Needs input even within the window; a coordinator is unaffected; a closed/exited pane is never forced working.
- [x] 4.3 Unit-test `runtime` `noteBusy`: a true detection sets `terminalBusyAt`; a later false detection leaves it unchanged; a later true detection re-arms it to the new time.

## 5. Verify

- [x] 5.1 Run `npm run check` and `npm run test`; ensure all green (including the scenario-coverage gate for the new/updated scenarios).
- [ ] 5.2 Manual check in the app: run a foreground command (`! sleep 8`) in an agent pane and confirm the agent holds In flight steadily (no flip to Needs-you) while it runs, and returns to Needs-you within ~3 s after it ends.
