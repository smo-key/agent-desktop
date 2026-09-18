## 1. Hook + backend field (TDD)

- [x] 1.1 Add failing tests in `src-tauri/resources/event-hook.test.ts` titled "Background tasks carried on a turn end" (Stop and SubagentStop with `background_tasks` → compact `backgroundTasks`; absent → omitted; non-array tolerated)
- [x] 1.2 Implement the `backgroundTasks` normalization in `src-tauri/resources/event-hook.cjs`
- [x] 1.3 Add `background_tasks: Option<Value>` (camelCase `backgroundTasks`, default, skip-if-none) to `AgentEvent` in `src-tauri/src/events.rs` with a Rust test `background_tasks_survive_the_durable_sink` (parse off the wire → record → ring + sink read-back)

## 2. Status derivation (TDD)

- [x] 2.1 Add `backgroundTasks` to the frontend `AgentEvent` in `src/lib/overview/events.ts` and failing tests in `src/lib/overview/events.test.ts` titled "Stop with running background tasks stays working", "Background task finishing returns the session to waiting", "Stop without a background task list classifies as before"
- [x] 2.2 Implement the `Stop` classification rule (running background task → `working` + `Background: <description>` / `N background tasks` current action) in `deriveEventActivity`
- [x] 2.3 Confirm the existing "Trailing SubagentStop preserves a completed turn as waiting" and "The parent's own turn end still reads Needs input" tests still pass unchanged (no `backgroundTasks` → old behavior)

## 3. Interrupt interaction (review finding, TDD)

- [x] 3.1 Add failing tests in `src/lib/overview/events.svelte.test.ts` titled "Interrupt is a no-op while only background work is running" and "Interrupt keeps background work In flight"
- [x] 3.2 Make `markInterrupt` a no-op when the last turn boundary is a `Stop` (nothing in flight), and carry the last real `Stop`'s running background-task list onto the synthetic turn-end otherwise

## 4. Adversarial-review findings (TDD)

- [x] 4.1 Only agent-like task types (`subagent`/`workflow`/`teammate`/`cloud session`) with `running`/`pending` status count; shells/monitors/housekeeping never pin a row — tests "Only agent-like background tasks keep the session working", "Pending background agents count as running"
- [x] 4.2 Forward `agentId` on `SubagentStop` (hook + Rust `agent_id`) and make `markInterrupt` use `outstandingBackgroundTasks` (last real Stop's agents minus finished) — tests "Subagent id carried on a subagent stop", "Interrupt after the background agent finished returns to waiting"
- [x] 4.3 A trailing `Notification` inherits the preceding Stop's running work; clip the background label — tests "Idle notification inherits running background work", "Long background descriptions are clipped in the current action"

## 5. Verify

- [x] 5.1 Run `yarn check`, `yarn test`, `yarn coverage`, and `cargo test` in `src-tauri`; confirm all pass
- [x] 5.2 Live-equivalent check: probe a real `claude -p` run with a stdin-dumping hook to capture the actual `run_in_background` Agent sequence (PreToolUse → SubagentStart → PostToolUse at +8 ms → Stop with `background_tasks[].status: running` → SubagentStop → Stop with `[]`) and drive the real `event-hook.cjs` + `deriveEventActivity` with those payloads in the unit tests. (An in-app check needs an app restart to pick up the embedded hook; it could not be done from a session running inside the app — see the close-out notes.)
- [x] 5.3 Run `openspec validate fix-background-task-needs-you` and confirm the change is well-formed
