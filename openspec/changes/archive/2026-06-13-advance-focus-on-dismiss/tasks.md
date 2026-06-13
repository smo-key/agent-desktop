## 1. Pure selection helper

- [x] 1.1 Add failing unit tests for `nextOnDismiss(rows, dismissedPaneId)` in `src/lib/overview/inbox.test.ts`: returns first Needs-you; falls back to first In-flight when no Needs-you; returns null when neither; excludes the dismissed pane even when it would qualify; respects roster (display) order for "first".
- [x] 1.2 Implement `nextOnDismiss` in `src/lib/overview/inbox.ts` (uses `attentionQueue` and `laneForRow`); make the tests pass.

## 2. Wire dismiss gestures in the inbox

- [x] 2.1 Add an `advanceAfterDismiss(paneId)` helper in `src/lib/overview/Inbox.svelte` that no-ops unless `paneId === shownId`, then clears any pending advance, drops the pin, sets `shownId = nextOnDismiss(viewRows, paneId)`, and bumps `focusNonce`.
- [x] 2.2 Call `advanceAfterDismiss` from `archiveAgent`, `pauseAgent`, and `deleteAgent` (before the `workspace.*` mutation). Leave the opt-in auto-advance effect untouched.

## 3. Verify

- [x] 3.1 Run `npm run test` (or the project test command) — all unit tests green, including the new `nextOnDismiss` cases. (994 passed; `npm run check` 0 errors; `npm run coverage` PASS.)
- [x] 3.2 Manual in-app verification — SKIPPED by user decision (2026-06-12): automated suite (994 tests) + svelte-check + scenario-coverage + adversarial code review (no CRITICAL) accepted as sufficient. The reconcile/teleport-effect interactions were verified by the adversarial reviewer against the actual code rather than by running the app.
- [x] 3.3 Update the `inbox-auto-advance` spec via the change's delta (handled at archive).
