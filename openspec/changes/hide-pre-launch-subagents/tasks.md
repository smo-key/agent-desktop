## 1. Pure filter (TDD)

- [x] 1.1 Add failing unit tests in `src-tauri/src/subagents.rs` for `filter_pre_launch(subagents, launch_time_ms)`: running pre-launch subagent dropped; completed pre-launch subagent dropped; subagent started at/after launch kept; subagent with `started_at == None` kept; empty input returns empty
- [x] 1.2 Implement `filter_pre_launch` so the tests pass — drop only when `started_at.is_some_and(|t| t < launch_time_ms)`

## 2. Wire the filter into the source

- [x] 2.1 Add a `launch_time_ms: i64` parameter to `subagents_for_sessions` and apply `filter_pre_launch` to each session's subagents after assembly
- [x] 2.2 Update `start_subagents_watcher` to accept and carry the launch-time threshold so the watcher's recompute filters identically to the seed

## 3. Capture launch time in the app

- [x] 3.1 In `src-tauri/src/lib.rs`, capture the app launch time (Unix millis) once at the top of `run()` and store it in Tauri managed state
- [x] 3.2 Pass the launch time into the `subagents_for` command and into `start_subagents_watcher`

## 4. Verify

- [x] 4.1 Run `cargo test` for the `subagents` module and confirm all tests (new + existing) pass
- [x] 4.2 Confirm `cargo build` (or `cargo check`) succeeds for `src-tauri`
- [x] 4.3 Run `openspec validate hide-pre-launch-subagents` and confirm the change is well-formed
