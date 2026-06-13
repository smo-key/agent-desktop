## 1. Runtime registry: hysteresis memory

- [x] 1.1 Add `lastStatus?: AgentStatus` to the `PaneRuntime` type (`roster.ts`) and document it as the hysteresis memory.
- [x] 1.2 Add `noteStatus(paneId, status)` to `runtime.ts` that writes `lastStatus` on the pane's runtime entry (via `entryFor`), mirroring `noteOutput`/`noteBusy`.
- [x] 1.3 Confirm `runtimeMap()` shallow-copies `lastStatus` into the snapshot (it copies all fields with `{ ...r }` — verify, no change expected).

## 2. Derivation: two-threshold hysteresis

- [x] 2.1 Add an `IDLE_GRACE_MS` constant (10000ms) in `roster.ts` next to `WORKING_WINDOW_MS`, with a comment explaining the promote-vs-demote asymmetry.
- [x] 2.2 Add an optional `prevStatus?: AgentStatus` parameter to `deriveStatus` and implement the band: `silent <= WORKING_WINDOW_MS` → working; `prevStatus === 'working' && silent <= IDLE_GRACE_MS` → working (hold); else → waiting. Exit/`lastOutputAt === null` branches unchanged.
- [x] 2.3 In `rowFor`, pass `runtime?.lastStatus` into `deriveStatus` as `prevStatus`. Thread the value through `buildRoster` (it already passes `runtime` per pane — no new top-level param needed).

## 3. Close the loop: record final status

- [x] 3.1 In `Inbox.svelte`, after each ~1s roster rebuild, call `noteStatus(row.paneId, row.status)` for each derived row so the next derivation sees the final (post-override) status. Place it where the rebuilt rows are available, on the existing heartbeat effect.
- [x] 3.2 Verify the recorded status is the FINAL `row.status` (after coordinator / terminalBusy overrides), not the raw PTY value.

## 4. Tests

- [x] 4.1 Unit-test `deriveStatus` hysteresis: working pane stays `working` for silence in (WORKING_WINDOW_MS, IDLE_GRACE_MS]; demotes to `waiting` past IDLE_GRACE_MS; a `waiting` prevStatus stays `waiting` once silent past WORKING_WINDOW_MS; fresh output (within WORKING_WINDOW_MS) returns `working` regardless of prevStatus.
- [x] 4.2 Unit-test fail-safe: `prevStatus === undefined` reproduces the exact pre-change single-window result at boundaries around WORKING_WINDOW_MS.
- [x] 4.3 Unit-test that positive signals are not held: an exited runtime returns `finished`/`error` immediately even with `prevStatus === 'working'`; and via `rowFor`, an event-sourced `waiting` / pending question / coordinator path overrides the hysteresis hold.
- [x] 4.4 Run the full test suite and lint/typecheck; confirm no regressions in existing `agent-status-derivation` / roster tests.

## 5. Manual verification

- [ ] 5.1 Run the app, start a long-running agent that goes quiet for 3–8s mid-work, and confirm its row no longer bounces working↔needs-you; confirm a genuinely idle agent still reads Needs you after the grace window; confirm an AskUserQuestion still reads Needs you immediately.
