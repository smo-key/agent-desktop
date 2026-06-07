## 1. Control channel (Rust ↔ frontend bridge)

- [ ] 1.1 Add a Rust control socket in `src-tauri/src/` (mirror the events socket in `events.rs`) that accepts JSON request/response with request ids and per-request timeouts
- [ ] 1.2 On each control request, emit a `coordinator://request` Tauri event to the frontend carrying the request id, op, and args
- [ ] 1.3 Add a `coordinator_reply` Tauri command the frontend calls to return a result/error for a request id; route it back to the waiting socket request
- [ ] 1.4 Add a small Rust-side serialization queue so injections/requests targeting one coordinator do not interleave
- [ ] 1.5 Unit-test the request/reply routing and timeout fallback in isolation

## 2. Bundled MCP toolkit adapter

- [ ] 2.1 Add a bundled stdio MCP server script under `src-tauri/resources/` (same Node family as `event-hook.cjs`) that exposes the toolkit tools and `ask_coordinator`
- [ ] 2.2 Implement each tool as a thin translation to a control-socket request: `spawn_agent`, `message_agent`, `read_agent`, `answer_question`, `list_agents`, `inspect_agent`, `archive_agent`, `unarchive_agent`
- [ ] 2.3 Implement `ask_coordinator` to route a question to the project's coordinator, returning a fallback-to-human signal when no coordinator is running
- [ ] 2.4 Generate per-session MCP config: full toolkit for the coordinator session, only `ask_coordinator` for normal project agents
- [ ] 2.5 Unit-test the adapter's request encoding and the no-coordinator fallback path

## 3. Frontend executor (pane-registry operations)

- [ ] 3.1 Handle `coordinator://request` events: dispatch each op to existing frontend functions and reply via `coordinator_reply`
- [ ] 3.2 Implement `spawn_agent` using the existing launcher path, bound to the coordinator's project, returning the new pane identity
- [ ] 3.3 Implement `message_agent` (write input to a pane's PTY) and `read_agent` (recent output/activity)
- [ ] 3.4 Implement `list_agents` and `inspect_agent` from the roster/activity stores
- [ ] 3.5 Implement `archive_agent` / `unarchive_agent` using existing archive state
- [ ] 3.6 Enforce project scoping in the executor: reject ops targeting panes outside the coordinator's project or closed/nonexistent panes

## 4. Coordinator lifecycle

- [ ] 4.1 Add a `role: 'coordinator'` flag to `PaneSession` and a `coordinatorSessionId` back-reference on `Project` (`projects.ts` + persistence)
- [ ] 4.2 Add a per-project "Start coordinator" affordance; launch a `claude` pane in the project with the toolkit MCP config and the role/guardrail system prompt
- [ ] 4.3 Enforce single coordinator per project: reuse/focus the existing one instead of launching a second
- [ ] 4.4 Persist and reuse the coordinator session across navigation; identify it after focus changes/restart
- [ ] 4.5 Author the coordinator system prompt: role, hybrid-autonomy policy, and the hard guardrail set

## 5. Escalation routing & autonomy

- [ ] 5.1 In `activity.rs`/`events.rs`, detect a non-coordinator agent's pending question/needs-input and, when its project has a running coordinator, route it to the coordinator (via the injection/queue channel) instead of straight to "Needs you"
- [ ] 5.2 Add loop/dup guards: never intercept the coordinator's own pane; do not re-route an already-routed item
- [ ] 5.3 Implement human fallback: no running coordinator, coordinator defer, or routing timeout → surface to "Needs you"
- [ ] 5.4 Implement the hard guardrail enforcement below the LLM: classify target items against the fixed guardrail set and refuse `answer_question` for matches, forcing defer-to-human
- [ ] 5.5 Implement `defer_to_human` so the coordinator can surface an item with an attached note

## 6. Human surfaces (roster + inbox)

- [ ] 6.1 Distinct coordinator treatment in the roster (`overview/roster.ts`, `Inbox.svelte`) — badge/lane identifying the project hub
- [ ] 6.2 Surface coordinator-deferred items in "Needs you" attributed to the coordinator and the originating agent (`activity.svelte.ts`, `events.svelte.ts`)
- [ ] 6.3 Verify a project with no coordinator behaves exactly as today (no interception, direct surfacing)

## 7. Verification

- [ ] 7.1 End-to-end: start a coordinator, have an agent call `ask_coordinator`, coordinator answers a routine item autonomously and unblocks the agent
- [ ] 7.2 End-to-end: an agent's `AskUserQuestion` is intercepted and routed to the coordinator; a guardrailed item is forced to the human with attribution
- [ ] 7.3 End-to-end: coordinator spawns, messages, inspects, and archives an agent; cross-project/invalid targets are rejected
- [ ] 7.4 Run `openspec validate add-project-coordinator` and the project's lint/test suite
