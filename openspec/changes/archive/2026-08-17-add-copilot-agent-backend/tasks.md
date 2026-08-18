## 1. Phase 0 — Spikes (record findings as design.md amendments)

- [x] 1.1 Run an interactive `copilot` session exercising tool calls, a subagent, and an ask-user question; capture a sanitized `events.jsonl` fixture into the repo test fixtures and document the exact event shapes (tool call, subagent lifecycle, ask-user) in design.md
- [x] 1.2 Pin down Copilot custom-agent definition: file location, format, whether it can carry a specialist persona body; decide `specialists` capability flag value and record in design.md
- [x] 1.3 Probe Copilot's ask-user TUI menu for deterministic PTY driving; decide `askUserDriving` capability flag and record in design.md
- [x] 1.4 Capture Copilot's TUI busy/interrupt affordance strings for the busy-marker fallback and record in design.md

## 2. Phase 1 — Backend abstraction, settings, launch/resume

- [x] 2.1 Create `src/lib/agent/backends.ts` with `AgentKind`, `AgentBackend` descriptors for claude and copilot (args, MCP style, model labels, readiness timing, busy markers, capability flags) + unit tests
- [x] 2.2 Add `agent` settings slice (`src/lib/settings/agent.svelte.ts`) with persistence tests, mirroring the shell slice
- [x] 2.3 Add "Agent" group to SettingsModal (dropdown + install detection hint); extend `shell_path.rs` safety-net dirs for the npm-global bin dir
- [x] 2.4 Widen `LaunchPlan.program` to `AgentKind`; launcher agent selector seeded from the global setting with per-session override; readiness constants from the descriptor (plan.ts, initialInput.ts, Launcher.svelte + tests)
- [x] 2.5 Make `buildSpawnOverride` backend-aware: claude path unchanged; copilot path emits `--session-id`/`--no-remote` (fresh) or `--resume` (restore), pane env, and no `--settings`/hooks/statusline + tests
- [x] 2.6 Replace `program === 'claude'` predicates with registry/capability lookups across workspace.svelte.ts, persistence.ts, store-backend.svelte.ts, TerminalPane.svelte, AppFooter.svelte, rosterInputs.ts, voice/insert.ts + tests; archive/restore/preview work for copilot panes

## 3. Phase 2 — Copilot observability

- [x] 3.1 Rust `copilot_events.rs`: notify-watcher + incremental tailer over `~/.copilot/session-state/<uuid>/events.jsonl`, version-tolerant parsing against the Phase 0 fixture + Rust tests
- [x] 3.2 Map turn/shutdown events into the status pipeline (busy/idle) and ask-user events into pending-question alerts; wire per-backend busy markers into terminalBusy.ts + tests
- [x] 3.3 Emit usage snapshots (model, tokens; no context/rate-limit fields) from the tailer into the existing snapshot pipeline; footer/model-label formatting per backend; degrade-without-context rendering + tests
- [x] 3.4 Feed Copilot transcript text into local title generation; map tool calls into the activity timeline sink; derive subagent rows from subagent events + tests
- [x] 3.5 Question-answer activation for copilot panes per the askUserDriving flag (drive the menu if spiked reliable, else focus-the-pane) + tests

## 4. Phase 3 — Specialists on Copilot

- [x] 4.1 Implement specialist → Copilot custom-agent translation and `--agent` launch mapping (or wire the declared "Claude only" degradation, per the 1.2 decision) + tests
- [x] 4.2 Update specialist launch surfaces (executor `spawn_agent`, specialists panel) to be backend-aware + tests

## 5. Phase 4 — Coordinator removal

- [x] 5.1 Delete coordinator code and tests: CoordinatorStart.svelte, coordinator.ts, coordinator.svelte.ts, coordinatorNeedsInput.svelte.ts, coordinatorPin, inbox coordinator rows, roster pin handling, coordinator system prompt; keep orchestration runtime and specialists
- [x] 5.2 Remove coordinator references from layout/persistence/status/overview code paths and specs-coverage mappings; delete superseded changes `add-project-coordinator` and `coordinator-agent-titles`
- [x] 5.3 Full gate: `yarn check:gate` and `cargo test` green

## 6. Close-out

- [x] 6.1 Amend design.md with all spike findings; reconcile any drift between artifacts and implementation
- [x] 6.2 Smoke the real CLI contract headlessly (done: app-minted `--session-id` accepted, `events.jsonl` at the expected path, `--resume <uuid>` continues the transcript, user messages in the event log, `--agent` custom-agent persona applied). The LIVE in-app pass — launch/prompt/resume/archive a copilot pane in the running app and eyeball status/title/usage/timeline — is MANUAL (needs a real window + PTY), matching the coverage gate's live-app convention
