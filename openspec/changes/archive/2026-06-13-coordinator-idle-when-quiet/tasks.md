## 1. Coordinator status: Working / Idle / Waiting (TDD)

- [x] 1.1 In `src/lib/overview/roster.test.ts`, update the coordinator status scenarios: change "Engaged but quiet coordinator stays Working" so a quiet engaged coordinator (old `lastOutputAt`, no `terminalBusyAt`, no question, no flag, `everPrompted`) now expects `status === 'idle'` with `needsAttention(row) === false` (renamed "Engaged but quiet coordinator reads Idle, out of attention").
- [x] 1.2 Add tests: an engaged coordinator with recent output (`lastOutputAt: now`) reads `working` ("Actively running coordinator reads Working"); quiet-but-fresh `terminalBusyAt` (within `BUSY_GRACE_MS`) reads `working`; a `terminalBusyAt` older than `BUSY_GRACE_MS` (quiet) reads `idle`. Updated the terminal-busy-override coordinator test to assert busy→working with no question but Waiting with a pending question. Freshly-launched (`everPrompted: false`) → `waiting` and pending-question/flag → `waiting` still pass.
- [x] 1.3 Edit the coordinator branch in `rowFor` (`src/lib/overview/roster.ts`): when the coordinator does NOT need you, set `working` only if actually running (`ptyStatus === 'working'` OR `terminalBusyAt` within `BUSY_GRACE_MS`), else `idle`. Left the `needsYou` → `waiting` branch and the non-coordinator terminal-busy override unchanged. Section 1 tests green.

## 2. Roster row: no in-flight dot when idle

- [x] 2.1 In `src/lib/overview/Inbox.svelte`, gate the in-flight dot so it does not render for an `idle` row: render the dot only when `needsAttention(r)` (orange) or the row is in the `flight` lane AND `r.status !== 'idle'` (actively working, blue). The idle coordinator (and a not-yet-wired pane) then shows no dot.

## 3. Verify

- [x] 3.1 Run `openspec validate coordinator-idle-when-quiet --strict` — valid.
- [x] 3.2 Run the full unit suite (vitest: 1198 passed) + type check (`svelte-check`: 0 errors) + scenario-coverage gate (PASS); all green. Adversarial code review (2 independent reviewers) found no CRITICAL/WARNING defects introduced by this change.
- [x] 3.3 Dot behavior verified by proxy: it is deterministically driven by the unit-tested coordinator status (`idle` → no dot; `working` → flashing dot; `waiting`/error → orange dot) and the one-line template gate was confirmed correct by adversarial review. NOT run live in-app this session — a quick live glance is recommended as a final sanity check (offered to the user).
