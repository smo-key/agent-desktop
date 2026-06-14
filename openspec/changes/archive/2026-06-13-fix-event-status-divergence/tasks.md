# Tasks

## 1. A — SubagentStop preserves the settled status

- [x] 1.1 In `src/lib/overview/events.ts` `deriveEventActivity`, when `inFlight` is null and the most recent event is a `SubagentStop`, classify status from the most recent NON-`SubagentStop` event using the existing turn-boundary rules (Stop/Notification/SessionStart/SessionEnd → waiting/finished; UserPromptSubmit/PostToolUse → working); fall back to `null` only when there is no prior non-`SubagentStop` event. Preserve `currentAction`/question semantics (still null here, no tool in flight). Update the doc comment.
- [x] 1.2 Unit-test in `events.test.ts` (or `events.svelte.test.ts`): a `Stop` then a trailing `SubagentStop` → `waiting` (not null); a `PostToolUse` then a trailing `SubagentStop` → `working`; multiple trailing `SubagentStop`s skip back correctly; a `SubagentStop` with no prior turn-boundary event → `null` (PTY fallback, unchanged); a `SubagentStop` while a tool is in flight is unaffected (still `working` from the in-flight tool).

## 2. B2 — Synthetic Stop preserved only while newest

- [x] 2.1 In `src/lib/overview/events.svelte.ts` `seed()`, change the preserve filter so a synthetic event is preserved only when `e.ts > snapshotLastTs` (treat synthetic the same as a live event for preservation), i.e. `existing.filter(e => e.ts > snapshotLastTs)` (synthetic flag no longer forces preservation). Update the merge comment to explain that a superseded synthetic `Stop` is dropped so a re-seed heals a spurious interrupt.
- [x] 2.2 Unit-test `seed()`: a synthetic `Stop` newer than the snapshot's last event is preserved (genuine interrupt); a synthetic `Stop` OLDER than a newer real event in the snapshot is dropped (superseded → working tail restored); existing "preserve newer live event" behavior unchanged.

## 3. B1 — Periodic safety re-seed

- [x] 3.1 In `src/routes/+page.svelte`, add a slow interval effect (`EVENT_RESEED_MS` ~5000) that calls `void events.seed(currentPaneRefs())`, alongside the existing session-set-change re-seed; clear the interval on teardown. Keep it cheap and best-effort (seed already swallows errors).

## 4. Verify

- [x] 4.1 Run `npm run check` and `npm run test`; all green (incl. the new event-status / seed tests).
- [ ] 4.2 Manual check: a session that ran its turn then has a background `SubagentStop` stays stably In-flight/Needs-you (no bounce); a working session whose UI showed Needs-you self-corrects within ~5s (reconciliation); a genuinely interrupted (Esc) working pane still returns to Needs-you and stays.
