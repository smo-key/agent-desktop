## 1. Pane model — notify-on-complete marker

- [ ] 1.1 Add a `notifyOnComplete?: boolean` marker to `PaneSession` alongside `role`/`specialist`/`coordinatorPaneId` (`src/lib/layout/workspace.svelte.ts` or wherever `PaneSession` is defined)
- [ ] 1.2 Persist/restore the marker with the rest of pane state (session persistence)

## 2. Notifier pure core (framework-free) + unit tests

- [ ] 2.1 Create `src/lib/orchestration/coordinator-notifications.ts` (pure, no Svelte/Tauri/DOM): notification types (`completion`, `exit`, `agent-message`) and a `formatNotifications(items)` that renders the `[orchestration] Agent "<title>" (pane <id>) …` lines and coalesces a list into one injected turn
- [ ] 2.2 Implement the completion watch state machine: working→idle (no pending question) fires once and re-arms on next working transition; `SessionEnd` fires a terminal notification; `notifyOnComplete:false` suppresses both
- [ ] 2.3 Implement the durable per-coordinator queue: enqueue/drain, hold-while-busy (no bounded-error), and per-coordinator serialization
- [ ] 2.4 Unit-test 2.1–2.3: message formatting, coalescing, one-ping-per-turn re-arm, pending-question exclusion, opt-out, terminal-on-`SessionEnd`, durable hold + drain-on-idle

## 3. Spawned-agent `message_coordinator` MCP config + adapter

- [ ] 3.1 Add a builder for a `message_coordinator`-only MCP config (mirror `buildMcpToolkitConfig`) carrying the agent's own paneId and its spawning coordinator's paneId in server env
- [ ] 3.2 Expose `message_coordinator({ text })` in the bundled stdio MCP adapter, translating to a control-socket `message_coordinator` request (same family as the existing toolkit tools)
- [ ] 3.3 Unit-test the adapter's `message_coordinator` request encoding and the config builder

## 4. Executor — spawn flag + `message_coordinator` op

- [ ] 4.1 In `spawnAgent` (`executor.svelte.ts`): read `notifyOnComplete` (default `true`), persist it on the new pane, and attach the `message_coordinator`-only MCP config (task 3.1) to the launch
- [ ] 4.2 Add a `message_coordinator` case to the executor dispatch: resolve the target coordinator (spawning coordinator, falling back to the project coordinator), enqueue an `agent-message` notification, and return a structured error when no coordinator is running
- [ ] 4.3 Unit-test: `spawn_agent` persists `notifyOnComplete` (default true / explicit false); `message_coordinator` routes to the right coordinator and errors when none is running

## 5. Notifier wiring (`.svelte.ts`)

- [ ] 5.1 Create `src/lib/orchestration/coordinator-notifier.svelte.ts`: subscribe to the events/activity stores, feed agent status/`SessionEnd` transitions into the pure watch (task 2.2) using each pane's `notifyOnComplete` and `coordinatorPaneId`
- [ ] 5.2 Drain the per-coordinator queue (task 2.3) when a coordinator goes working→idle, gating delivery on coordinator idle (not mid-turn, not on an interactive menu) and injecting the coalesced turn via the existing `sendToPane`
- [ ] 5.3 Discard completion/exit notifications when the target coordinator is not running; ensure no-coordinator never throws
- [ ] 5.4 Start/stop the notifier with the executor lifecycle (alongside `executor.start()`/`stop()`)

## 6. Event-driven coordinator prompt

- [ ] 6.1 Rewrite `ORCHESTRATOR_SYSTEM_PROMPT` "How to work" in `coordinator.ts`: replace "Poll their status…" with delegate-then-end-your-turn; document that the coordinator is woken by `message_coordinator` updates and `notifyOnComplete` completions, and to keep `notifyOnComplete` (default `true`) for agents whose completion it must act on
- [ ] 6.2 Add `message_coordinator` to the toolkit list in the prompt context for spawned agents' awareness (and confirm it is NOT presented as a coordinator-side tool)
- [ ] 6.3 Update the `coordinator.ts` unit tests for the new prompt wording (no "Poll" instruction; mentions yielding + notifications)

## 7. Verification

- [ ] 7.1 Run the project's lint/type/test suite; all green
- [ ] 7.2 End-to-end: spawn an agent (default), let it finish a turn → coordinator receives a completion notification carrying the final message and acts without polling
- [ ] 7.3 End-to-end: a spawned agent calls `message_coordinator` mid-task → the update is injected into the (idle) coordinator; multiple updates while the coordinator is busy arrive coalesced as one turn
- [ ] 7.4 End-to-end: `notifyOnComplete:false` agent stays silent; an agent blocked on `AskUserQuestion` produces no completion notification
- [ ] 7.5 Run `openspec validate add-coordinator-notifications --strict`
