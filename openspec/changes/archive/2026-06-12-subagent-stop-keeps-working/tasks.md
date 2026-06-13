## 1. Failing tests (TDD red)

- [x] 1.1 In `src/lib/overview/events.test.ts`, add a test: a `Task` PreToolUse in flight followed by `SubagentStop` → `deriveEventActivity` returns `status: 'working'` with the Task still the `currentAction`.
- [x] 1.2 Add a test: a `SubagentStop` followed later by a `Stop` (no tool in flight) → `status: 'waiting'` (the parent's own turn end still reads Needs input).
- [x] 1.3 Add a test: events containing only a `SubagentStop` (no `UserPromptSubmit`) → `everPrompted === true` (subagent run proves the session was prompted).
- [x] 1.4 Run the suite and confirm 1.1/1.2 fail for the right reason (current code maps `SubagentStop` → `waiting` / clears in-flight); 1.3 already passes via `impliesEverPrompted`.

## 2. Implementation (TDD green)

- [x] 2.1 In `deriveEventActivity` (`src/lib/overview/events.ts`), remove `SubagentStop` from the in-flight-clearing `switch` (it must NOT clear the in-flight tool).
- [x] 2.2 Remove `SubagentStop` from the `waiting` last-event mapping so it no longer forces Needs input; a `SubagentStop` with no tool in flight falls through to the PTY-heuristic fallback (`status: null`).
- [x] 2.3 Leave `impliesEverPrompted` unchanged (keeps `SubagentStop`), and leave `Stop` / `Notification` / `SessionStart` handling untouched.
- [x] 2.4 Update the function's doc-comment status-precedence list to reflect that `SubagentStop` is no longer a turn end for the host pane.

## 3. Verify

- [x] 3.1 Run `npm test` (or the project's vitest task) for `src/lib/overview/` — all new and existing tests pass, including `roster.test.ts`. (Full suite: 987 passed; `npm run check`: 0 errors; coverage gate: PASS.)
- [x] 3.2 Re-read the diff against the spec scenarios to confirm each is covered by a test.
