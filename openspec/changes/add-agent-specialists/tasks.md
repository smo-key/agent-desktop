## 1. Spike: spawn a claude pane as a specialist

- [x] 1.1 Spike the `claude` CLI surface for composing a session from a specialist: confirm which of `--append-system-prompt`, `--model`, `--allowedTools`, `--mcp-config` exist and behave (system prompt actually applied, model/tools honored)
- [x] 1.2 Decide the composition path and record it in design.md (Open Questions → Decisions); if direct system-prompt injection is unavailable, confirm the `initialInput` persona-preamble fallback
- [x] 1.3 Capture the chosen launch-args shape as a small pure helper signature (specialist file → launch args) to be implemented in task 3

## 2. Specialist model + persistence

- [x] 2.1 Add a pure `src/lib/specialists/specialists.ts`: a `Specialist` type and pure (de)serialize between `.claude/agents/<name>.md` (YAML frontmatter + body) and the model; unit-test round-trip + malformed-frontmatter handling
- [x] 2.2 Add name validation (unique within project, filename-safe) as a pure function; unit-test duplicates and unsafe names
- [x] 2.3 Add Tauri commands in `src-tauri/src/` to list / read / write / delete `<project>/.claude/agents/*.md`; mirror the app-data JSON read/write helpers in `lib.rs`; unit-test the list/read/write/delete IO in a temp dir
- [x] 2.4 Add a reactive `src/lib/specialists/specialists.svelte.ts` store wrapping the commands (load by active project, create/edit/delete), tolerant of malformed entries (surface as read errors, never throw)

## 3. Orchestration runtime — transport + executor

- [x] 3.1 Add a Rust control-socket module (mirror `events.rs`): accept JSON request/response with request ids and per-request timeouts; unit-test request/reply routing and timeout fallback in isolation
- [x] 3.2 On each control request, emit an `orchestration://request` Tauri event carrying request id, op, and args
- [x] 3.3 Add an `orchestration_reply` Tauri command the frontend calls to return a result/error for a request id; route it back to the waiting socket request; unit-test concurrent requests do not cross results
- [x] 3.4 Add a Rust-side per-target serialization queue so injections/requests to one agent do not interleave; unit-test ordering + deferral
- [x] 3.5 Add the bundled stdio MCP adapter under `src-tauri/resources/` (same Node family as `event-hook.cjs`) exposing `spawn_agent` / `message_agent` / `read_agent` / `list_agents` / `inspect_agent` / `archive_agent` / `unarchive_agent` as thin translations to control-socket requests; unit-test the adapter's request encoding
- [x] 3.6 Generate the per-session MCP config that attaches this toolkit to a coordinator session launch

## 4. Orchestration runtime — frontend executor ops

- [x] 4.1 Handle `orchestration://request` events: dispatch each op to existing frontend functions and reply via `orchestration_reply`
- [x] 4.2 Implement `spawn_agent` via the existing launcher path, bound to the coordinator's project, returning the new pane identity; support the optional `specialist` arg (compose launch from the specialist file using the task-1 helper) and record the specialist on the spawned pane
- [x] 4.3 Implement `message_agent` (`pty_write` to a pane) and `read_agent` (recent output/activity), applying to both spawned agents and the user's existing project sessions
- [x] 4.4 Implement `list_agents` (every `claude` agent pane in the project, including pre-existing user sessions) and `inspect_agent`
- [x] 4.5 Implement `archive_agent` / `unarchive_agent` using existing archive state
- [x] 4.6 Enforce project scoping in the executor: reject ops targeting panes outside the coordinator's project or closed/nonexistent panes; gate injections on the target being idle

## 5. Specialists panel (UI)

- [x] 5.1 Add a Specialists panel (sibling to Projects/Tasks) listing the active project's specialists with an empty state
- [x] 5.2 Add the create/edit form (name, description, model, tools) + system-prompt editor (body), wired to the store; surface validation messages
- [x] 5.3 Add delete with confirmation; refresh the list on create/edit/delete
- [x] 5.4 Badge a spawned pane in the roster/overview with its specialist identity (read the recorded specialist from the pane)

## 6. Coordinator lifecycle + dynamic workflows

- [x] 6.1 Add a `role: 'coordinator'` marker to `PaneSession` and a `coordinatorSessionId` back-reference on `Project` (`projects.ts` + persistence)
- [x] 6.2 Add a per-project "Start coordinator" affordance; launch a `claude` pane in the project with the toolkit MCP config (task 3.6) and the orchestrator system prompt
- [x] 6.3 Enforce single coordinator per project: reuse/focus the existing one instead of launching a second; persist and reuse across navigation/restart
- [x] 6.4 Author the orchestrator system prompt: take a goal, plan, spawn and coordinate specialists and existing sessions via the toolkit (no governance/guardrails here)
- [x] 6.5 Attribute coordinator-spawned/driven agents to the coordinator in the roster/overview

## 9. UI refinements (follow-up scope)

- [x] 9.1 Specialist (Agent) form: replace the free-text `model` field with a dropdown (curated Claude model ids + a "Default / inherit" option) and the free-text `tools` field with a multiselect of Claude Code tool names; round-trip to the same frontmatter model/tools
- [x] 9.2 Rename the user-facing tabs: "Agents" → "Sessions" (running sessions) and "Specialists" → "Agents" (the specialist library); keep internal capability/model naming (`specialist`) unchanged
- [x] 9.3 Make the renamed "Sessions" tab area resizable (a draggable splitter), consistent with the existing resizable panel idiom

## 7. Cross-change: extract shared runtime from add-project-coordinator

- [x] 7.1 Edit `openspec/changes/add-project-coordinator/specs/coordinator-toolkit/spec.md` to keep only governance (`answer_question` + guardrails) and reference `agent-orchestration-runtime` for the transport + spawn/message/read/list/inspect/archive
- [x] 7.2 Edit `add-project-coordinator/specs/project-coordinator/spec.md` (and `design.md` D1/D2/D5 notes) to consume `agent-orchestration-runtime` instead of re-specifying the socket + toolkit
- [x] 7.3 Run `openspec validate add-project-coordinator` and confirm no toolkit spec is duplicated across the two changes

## 8. Verification

- [ ] 8.1 End-to-end (acceptance): create a specialist → start the coordinator → give it a goal → it spawns that specialist as a visible pane, messages/reads it, and coordinates to completion, all attributed in the roster — _logic verified via unit/integration tests + final integration review; LIVE in-app acceptance run still pending_
- [ ] 8.2 End-to-end: coordinator lists, reads, and messages a user-started existing session in the project as part of a workflow — _logic covered by executor tests + review; LIVE in-app run still pending_
- [x] 8.3 End-to-end: cross-project / invalid / closed targets are rejected; an injection to a busy agent is deferred until idle — verified by `executor.svelte.test.ts` (scoping, idle-gating, coordinator-target rejection)
- [x] 8.4 Confirm additive behavior: a project with no coordinator and no specialists behaves exactly as today — verified by review (no interception without a coordinator; empty-state panels)
- [x] 8.5 Run `openspec validate add-agent-specialists` and the project's lint/test suite (`npm` + `cargo test`) — vitest 656/656; cargo 162 pass (+2 pre-existing unrelated `events::tests`); openspec validate green

## 10. Coordinator constraints + Sessions placement (follow-up scope)

- [x] 10.1 Restrict the coordinator at launch so it cannot do work: disallow the work tools (`Edit`, `Write`, `Bash`, `NotebookEdit`) and the internal `Task` tool while keeping the orchestration toolkit + read-only inspection; reinforce in the orchestrator system prompt that it must create sessions (optionally specialists) to do all work and never do it itself
- [x] 10.2 Pin the coordinator to the TOP of the Sessions list (above all other sessions), with a horizontal rule separating it from the rest and no separate heading
- [x] 10.3 When the active project has no running coordinator, show a focusable "Start coordinator" affordance in that top slot
- [x] 10.4 Focusing the not-started coordinator shows an empty main-pane state inviting the user to click a Start button that launches the orchestrator
