## 1. Hook script (`event-hook.cjs`)

- [x] 1.1 Write failing unit tests for the input-summary mapper (`Bash`, `Edit`, `Write`, `Read`, `Task`, MCP, unknown → `tool_name`)
- [x] 1.2 Write failing tests for stdin → normalized-event mapping (paneId from env, sessionId, hook_event_name, timestamp; AskUserQuestion payload carried)
- [x] 1.3 Write failing test that the hook exits 0 and is silent when the socket is absent (connect timeout path)
- [x] 1.4 Implement `src-tauri/resources/event-hook.cjs`: read stdin, normalize, summarize, connect to `AGENT_DESKTOP_SOCKET_PATH`, write one JSON line, swallow all errors, exit 0
- [x] 1.5 Verify all hook-script tests pass

## 2. Spawn wiring (`buildSpawnOverride`)

- [x] 2.1 Update `spawn.test.ts`: assert `AGENT_DESKTOP_SOCKET_PATH` env injected and `event-hook.js` registered for the full event set with all-tools matchers on Pre/PostToolUse, preserving shell-quoting
- [x] 2.2 Implement env + hook-set registration in `src/lib/usage/spawn.ts`; keep `statusLine` (demoted) and `remoteControlAtStartup:false`
- [x] 2.3 Verify spawn tests pass

## 3. Rust socket server + durable sink

- [x] 3.1 Write failing Rust tests for `events.rs`: accept → parse → emit `overview://event` + ring append; malformed line dropped without killing the loop; stale-socket unlink on boot
- [x] 3.2 Write failing tests for the durable sink: append to `events/<sessionId>.jsonl`; distinct sessions never cross-contaminate
- [x] 3.3 Write failing tests for retention: prune logs older than the window; truncate an oversized log from the head
- [x] 3.4 Implement `src-tauri/src/events.rs`: Unix listener (unlink stale, bind), tokio accept loop, parse `AgentEvent`, receive-time stamp, bounded per-pane ring (~500), durable append, emit event
- [x] 3.5 Implement retention (age + per-session size cap, both configurable) run on startup
- [x] 3.6 Implement `events_for(paneId|sessionId)` command (ring → durable-file fallback) and add `socket_path` to `usage_paths`
- [x] 3.7 Register the socket server, command, and shutdown socket-cleanup in `src-tauri/src/lib.rs`
- [x] 3.8 Verify all Rust event tests pass

## 4. Frontend event store

- [x] 4.1 Write failing tests for `events.svelte.ts`: ingest `overview://event`, maintain `paneId → Event[]` ring, derive `currentAction` (latest PreToolUse without matching PostToolUse, cleared on Post/Stop)
- [x] 4.2 Write failing tests for seeding via `events_for` on mount
- [x] 4.3 Implement `src/lib/overview/events.svelte.ts`
- [x] 4.4 Verify event-store tests pass

## 5. Event-sourced status, currentAction, timeline

- [x] 5.1 Write failing tests for the event → status mapping (working / waiting / done / error / fallback) per `activity-timeline` scenarios
- [x] 5.2 Implement event-sourced status in `runtime.ts`/`view.svelte.ts`; demote PTY-byte heuristic to fallback; keep PTY `exit` authoritative
- [x] 5.3 Add `currentAction` to `AgentRow` (`roster.ts`) and surface the per-tool timeline (seeded from `events_for`)
- [x] 5.4 Verify status/roster/timeline tests pass

## 6. Event-triggered transcript reads

- [x] 6.1 Write failing tests: `activity_for` invoked on `Stop`/`PostToolUse`; ~5s safety poll backstops; no fixed 1.5s loop remains
- [x] 6.2 Implement event-triggered reads + safety poll in `+page.svelte` / `activity.svelte.ts`; remove the 1.5s cadence
- [x] 6.3 Verify polling tests pass

## 7. Pending question via event + retire sidecar

- [x] 7.1 Write failing tests: pending question surfaced from the `PreToolUse[AskUserQuestion]` event; cleared on Post/Stop; no sidecar read
- [x] 7.2 Source pending question from the event store; retire the sidecar reader. The pending `AskUserQuestion` now comes from the `PreToolUse[AskUserQuestion]` event (frontend event store), preferred over the activity poll (`roster.ts`: `event?.questions ?? activity?.questions`). At close-out (after `add-agent-desktop` archived) the deferral was resolved: `read_pending_questions` + `question_summary` + the sidecar block in `activity_for_panes` and the `pending_question_comes_from_the_sidecar` Rust test were REMOVED, and the agent-overview "Pending question comes from the sidecar" scenario was reconciled to event-sourced (scenario removed; prose cross-refs `activity-timeline`).
- [x] 7.3 Delete `src-tauri/resources/question-hook.cjs` and any now-dead references
- [x] 7.4 Verify question tests pass

## 8. Persistence rehydration + backfill

- [x] 8.1 Write failing tests: `events_for` seeds prior timeline on resume; transcript backfill reconstructs a completed-tool timeline when no sink exists
- [x] 8.2 Implement transcript-based backfill (parse `tool_use`/`tool_result`) for sessions with no durable sink
- [x] 8.3 Verify rehydration/backfill tests pass

## 9. Integration & validation

- [x] 9.1 Integration test: a simulated event sequence (incl. a restart seeded from disk) drives expected `status`/`currentAction`/timeline transitions
- [x] 9.2 Run full svelte-check + frontend + Rust test suites green
- [x] 9.3 `openspec validate add-activity-event-pipeline --strict` passes
- [x] 9.4 Manual smoke: launch a session, confirm live status/currentAction/timeline, answer a question, restart the app, confirm the timeline rehydrates. — confirmed by user high-level testing (close-out).
