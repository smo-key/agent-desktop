## 1. Data layer — extend the Subagent record (Rust)

- [x] 1.1 Add `phase_title: Option<String>`, `phase_index: Option<i64>`, `started_at: Option<i64>`, `duration_ms: Option<i64>` to the `Subagent` struct in `src-tauri/src/subagents.rs`, serialized camelCase (`phaseTitle`, `phaseIndex`, `startedAt`, `durationMs`).
- [x] 1.2 In `parse_session_subagents` (the `workflowProgress` agent-row parser), map the four new fields from each `workflow_agent` row (`phaseTitle`, `phaseIndex`, `startedAt`, `durationMs`), keeping every field optional/tolerant of absence.
- [x] 1.3 Extend the existing `subagents.rs` parser tests to assert the four new fields are populated from a representative `workflowProgress` row, and that a row missing those fields parses to `None` without error.

## 2. Data layer — mirror the wire shape (TS)

- [x] 2.1 Add `phaseTitle?`, `phaseIndex?`, `startedAt?`, `durationMs?` (all `number | null` / `string | null` as appropriate) to the `Subagent` interface in `src/lib/overview/subagents.svelte.ts`, matching the Rust camelCase output.

## 3. Grouping + duration helpers (pure, tested)

- [x] 3.1 Add `groupSubagentsByPhase(subagents): WorkflowGroup[]` (in `subagents.svelte.ts` or a sibling pure module): bucket by `workflowId`, then by `phaseTitle` ordered by `phaseIndex`; preserve parser order within a phase; route records missing `workflowId`/`phaseTitle` into a stable "ungrouped" bucket rather than dropping them.
- [x] 3.2 Add `formatDurationAlive(sub, nowMs): string`: use `durationMs` when present (finished), else `nowMs − startedAt` (running), else empty; format compactly (e.g. `2m 14s`).
- [x] 3.3 Unit-test `groupSubagentsByPhase` (grouping, phase ordering, ungrouped bucket, empty input) and `formatDurationAlive` (finished, running, missing data).

## 4. Render nested rows (Inbox)

- [x] 4.1 In `src/lib/overview/Inbox.svelte`, for rows on the In-flight and Needs-you lanes only, look up `subagents.forSession(snapshot.sessionId)` and run it through `groupSubagentsByPhase`.
- [x] 4.2 Render the grouped result as always-expanded indented rows: a small workflow/phase group header, then each subagent mini-row with a status indicator (running/done/error, neutral fallback for unknown `status`), its label, and `formatDurationAlive(...)` driven by the Inbox's existing relative-time clock.
- [x] 4.3 Confirm no subagent rows render for Paused/Archived lane rows, and that an agent with no subagents renders exactly as today (no empty group artifacts).

## 6. Standalone Task subagents (the primary real-world case)

- [x] 6.1 In `src-tauri/src/activity.rs`, widen `parse_iso_millis` to `pub(crate)` so the subagents parser can reuse it (no duplicate date math).
- [x] 6.2 In `src-tauri/src/subagents.rs`, add a parser for bare standalone `Task` subagents: enumerate `subagents/agent-<id>.meta.json` directly under `subagents/` (skip the `workflows/` subdir), read `description` (→ label) and `toolUseId`, and derive `startedAt`/`durationMs` from the sibling `agent-<id>.jsonl`'s first/last entry timestamps. Emit with `workflow_id: None` (flat/ungrouped).
- [x] 6.3 Derive each standalone subagent's status from the parent transcript (`<project>/<session>.jsonl`, bounded tail): `running` iff its `toolUseId` appears as a `Task` `tool_use` with no matching `tool_result` in the tail; otherwise `done`. Scan the parent once per session, only when bare subagents exist.
- [x] 6.4 Merge standalone subagents into `parse_session_subagents` alongside the workflow subagents (no overlap: workflow agents live under `subagents/workflows/`, standalone directly under `subagents/`).
- [x] 6.5 Rust tests: a standalone subagent surfaces with its `description` label + duration (`standalone_task_subagents_appear_under_their_parent_agent`); status is `done` when the parent has a `tool_result` and `running` when it does not (`standalone_subagent_status_reflects_the_parent_result`); malformed/absent sidecars are tolerated.

## 5. Verify

- [x] 5.1 Run the Rust tests (`cargo test` for the subagents module) and the TS unit tests (`npm test` for the new helper specs); confirm green.
- [x] 5.2 Run `openspec validate add-inbox-workflow-subagent-rows` and confirm the change is well-formed.
- [ ] 5.3 Manually confirm in the running app that a session shows its subagents nested under the parent (workflow subagents grouped by phase; standalone `Task` subagents as a flat list), each with status and a ticking/settled duration.
