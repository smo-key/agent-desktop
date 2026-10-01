## 1. Rust

- [x] 1.1 `activity.rs`: incremental user-message count (per-path byte offset + count cache, reset on shrink/replace; parse only candidate lines)
- [x] 1.2 `events.rs`: sink read returns at most the ring-capacity tail
- [x] 1.3 `subagents.rs`: parent-tool scan skips lines without tool blocks before JSON parsing
- [x] 1.4 `lib.rs`: `session_focus` whole-transcript reads moved to `spawn_blocking`

## 2. Frontend

- [x] 2.1 Stable session-set key (`appSessionKey`) drives the subagents / events re-seeds; seeds run untracked
- [x] 2.2 `WorkspaceStore` derived id index; `sessionAnywhere` / `sessionIn` / `focusedIdIn` use it; adopt effect uses it
- [x] 2.3 Coalesced, single-flight event-driven `refreshActivity`
- [x] 2.4 Roster rows identity-stable across ticks (`stabilizeRows`); lane order uses a precomputed rank map
- [x] 2.5 Archived panes mount no TaskBadge

## 3. Verify

- [x] 3.1 `cargo test`, `yarn check`, `yarn test`, `yarn coverage` green; `openspec validate perf-scale-archived-sessions`

## 4. Adversarial review follow-ups

- [x] 4.1 Slow (15 s, hidden-gated) subagents safety re-seed — replaces the backstop the per-snapshot re-seed used to provide implicitly
- [x] 4.2 `sameRow` treats a key present in one row but absent in the other as a change
- [x] 4.3 Accepted (WARNING): incremental user-count cache treats an in-place same-inode rewrite larger than the offset as an append (Claude Code only appends transcripts)
- [x] 4.4 Accepted (WARNING): `read_tail_events` is quadratic in the length of a single multi-chunk line (pathological input only; results correct)
- [x] 4.5 Accepted (WARNING): `#byPane` resolves a pane to the first registry holding the KEY, where the old scan skipped falsy values (no writer stores `undefined`)
