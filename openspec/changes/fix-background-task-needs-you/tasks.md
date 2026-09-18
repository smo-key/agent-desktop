## 1. Hook + backend field (TDD)

- [x] 1.1 Add failing tests in `src-tauri/resources/event-hook.test.ts` titled "Background tasks carried on a turn end" (Stop and SubagentStop with `background_tasks` → compact `backgroundTasks`; absent → omitted; non-array tolerated)
- [x] 1.2 Implement the `backgroundTasks` normalization in `src-tauri/resources/event-hook.cjs`
- [x] 1.3 Add `background_tasks: Option<Value>` (camelCase `backgroundTasks`, default, skip-if-none) to `AgentEvent` in `src-tauri/src/events.rs` with a Rust test `background_tasks_survive_the_durable_sink` (parse off the wire → record → ring + sink read-back)

## 2. Status derivation (TDD)

- [x] 2.1 Add `backgroundTasks` to the frontend `AgentEvent` in `src/lib/overview/events.ts` and failing tests in `src/lib/overview/events.test.ts` titled "Stop with running background tasks stays working", "Background task finishing returns the session to waiting", "Stop without a background task list classifies as before"
- [x] 2.2 Implement the `Stop` classification rule (running background task → `working` + `Background: <description>` / `N background tasks` current action) in `deriveEventActivity`
- [x] 2.3 Confirm the existing "Trailing SubagentStop preserves a completed turn as waiting" and "The parent's own turn end still reads Needs input" tests still pass unchanged (no `backgroundTasks` → old behavior)

## 3. Verify

- [ ] 3.1 Run `yarn check`, `yarn test`, `yarn coverage`, and `cargo test` in `src-tauri`; confirm all pass
- [ ] 3.2 Live check: in the app, ask a session to launch a background Agent and end its turn; the row stays In flight (current action "Background: …") with no alert, then returns to Needs you once the subagent reports back
- [ ] 3.3 Run `openspec validate fix-background-task-needs-you` and confirm the change is well-formed
