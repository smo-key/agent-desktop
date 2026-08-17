## Context

The app is coupled to Claude Code at three depths:

1. **Generic already** — the Rust PTY layer (`pty.rs` spawns any
   `program`/`args`), the orchestration control socket, the usage snapshot
   watcher (app-owned JSON format), and settings persistence
   (`saveSettingsSlice` keyed slices).
2. **Mechanically Claude-shaped** — `LaunchPlan.program` is the literal type
   `'claude'`; ~30 `program === 'claude'` predicates across launcher, layout
   persistence, usage footer, roster, voice insert; launch-arg composition
   (`spawn.ts` injects `--session-id`/`--resume`/`--settings`/`--mcp-config`);
   startup-quiet timing constants; the `claude-…` model-id label parser;
   `shell_path.rs` safety-net dirs.
3. **Claude-private observability** — hook events + statusline protocol
   (`event-hook.cjs`, `statusline-wrapper.cjs`), transcript JSONL tailing
   (`activity.rs`), subagent sidecars (`subagents.rs`), `~/.claude/tasks` +
   `$TMPDIR/claude-ctx-*` (`task.rs`), `.claude/agents/*.md` specialists, TUI
   menu driving (`answer.ts`), spinner-string busy detection
   (`terminalBusy.ts`).

Verified against Copilot CLI 1.0.80 on this machine:

- `copilot --session-id <uuid>` **sets the UUID for a new session**; `--resume
  <id>` resumes; `-C <dir>` sets cwd. The app's session-identity contract
  (app-minted UUIDs) holds for both backends.
- Per-session state lives at `~/.copilot/session-state/<session-id>/` with
  `workspace.yaml` (cwd, branch, name, timestamps) and `events.jsonl` — typed
  events observed: `session.start`, `session.model_change`, `system.message`,
  `user.message`, `assistant.turn_start`, `assistant.message` (model,
  content, `toolRequests`, `outputTokens`), `assistant.turn_end`,
  `session.usage_checkpoint`, `session.shutdown`. Tool/subagent/ask-user event
  shapes must be confirmed in an interactive spike (docs name `call_tool` and
  `subagentStart`).
- MCP: `--additional-mcp-config <json|@file>` augments
  `~/.copilot/mcp-config.json` per session. Custom agents: `--agent <agent>`.
  Model/tools: `--model`, `--available-tools`, `--allow-tool`, `--deny-tool`.
  `--no-remote` disables remote control. There is no statusline, no hooks, no
  `--append-system-prompt`.

## Goals / Non-Goals

**Goals:**

- Operators choose the agent backend globally in Settings and per-session in
  the launcher; Copilot panes are first-class agent panes (launch, initial
  prompt, resume, archive/restore, preview, recents, voice insert).
- Copilot panes get real status/activity/usage/titles/subagent parity derived
  from `events.jsonl`, not a permanently-idle card.
- Every gap is a *declared* capability degradation (feature absent), never a
  broken surface (feature blank/wedged).
- The coordinator feature is fully removed; orchestration runtime and
  specialists survive it.

**Non-Goals:**

- No Copilot statusline/context-% meter (Copilot exposes no context window
  usage; the footer renders without it).
- No task badges for Copilot panes (no tasks-dir equivalent).
- No porting of the coordinator to Copilot (it is removed instead).
- No per-project agent binding (global default + per-session override only).
- No bundling or auto-installing of the Copilot CLI.

## Decisions

**D1 — Backend descriptor, not scattered conditionals.** New pure module
`src/lib/agent/backends.ts`: `AgentKind = 'claude' | 'copilot'`, and
`AgentBackend` = `{ kind, program, freshArgs(sessionId), resumeArgs(sessionId),
mcpConfigArgs(json), specialistArgs(spec) | null, modelLabel(id),
readiness: {quietMs, maxMs, submitDelayMs}, busyMarkers: string[],
capabilities: { hooks, statusline, contextPct, tasksDir, subagents,
specialists, askUserDriving } }`. `LaunchPlan.program` widens to `AgentKind`;
predicates become `isAgentProgram(p)` (any backend) or
`backendFor(p).capabilities.x` (feature gates). Alternative rejected: keeping
`program: string` and branching inline — that is how the current 30-site
coupling happened.

**D2 — Settings slice + launcher override.** `src/lib/settings/agent.svelte.ts`
persists `{ default: AgentKind }` via `saveSettingsSlice('agent', …)`,
mirroring the `shell` slice. SettingsModal gains an "Agent" group beside
Terminal: Dropdown (Claude Code / GitHub Copilot) + install detection (resolve
the binary via the login-shell PATH; absent → quiet mono hint with the install
command; selection still allowed). The Launcher gets an agent selector seeded
from the global default; `buildLaunchPlan` takes the resolved kind. Alternative
rejected: per-project agent (user chose global + override).

**D3 — Shared session-identity contract.** Both backends accept an app-minted
UUID (`--session-id`) and resume by it (`--resume`). Persistence keys stay
`(program, sessionId)`; archive/restore/preview predicates change from
`=== 'claude'` to `isAgentProgram`. No backend-reported-id capture path is
needed. Risk retired by live verification.

**D4 — Observability via events.jsonl tailing in Rust.** New
`src-tauri/src/copilot_events.rs`: a `notify` watcher + incremental tailer over
`~/.copilot/session-state/<session-id>/events.jsonl`, located directly by the
app-minted UUID (no cwd-encoding hunt). It translates events into the
*existing* app-owned sinks:

- `assistant.turn_start` → busy; `assistant.turn_end` / `session.shutdown` →
  idle (same event vocabulary `events.rs` feeds today).
- ask-user tool requests (shape confirmed in spike) → pending-question alerts.
- `assistant.message.model` + `outputTokens` + `session.usage_checkpoint` →
  usage snapshot JSON (same schema `usage.rs` already watches; context fields
  omitted).
- user/assistant text → the existing local title generation input.
- tool/subagent events → activity timeline entries and subagent rows.

Alternative rejected: reading `session.db` (SQLite) — richer queries but a
private schema, a new dependency, and polling instead of file events.
Alternative rejected: a Node sidecar tailer — the app already does exactly this
pattern in Rust for Claude (`activity.rs`, `task.rs`).

**D5 — Busy-marker fallback per backend.** `terminalBusy.ts` takes the marker
set from the backend descriptor; Copilot's spinner/affordance strings are
captured in the spike. The events tailer is primary; string scanning stays the
cheap fallback it is today.

**D6 — Specialists translate to Copilot custom agents.** Specialists remain
authored as `.claude/agents/*.md`. Launching a specialist on Copilot writes a
translated custom-agent file (location/format pinned in spike; expected
`~/.copilot/agents/` or project-level) and passes `--agent <name>`, with
frontmatter `model` → `--model` and `tools` → `--available-tools`. If the
spike shows the surface cannot express the persona (no system-prompt append),
`specialistArgs` returns `null` for copilot and the UI shows the declared
"Claude only" degradation. Alternative rejected: dual-authoring specialists in
two formats — one source of truth, translated at launch.

**D7 — Coordinator removal is a hard delete.** Remove
`CoordinatorStart.svelte`, `coordinator.ts`, `coordinator.svelte.ts`,
`coordinatorNeedsInput.svelte.ts`, `coordinatorPin.ts`, inbox coordinator
rows, roster pin handling, and their tests; remove the two coordinator specs
via `REMOVED` deltas; delete the superseded unarchived changes
`add-project-coordinator` and `coordinator-agent-titles`. The orchestration
runtime (`orchestration.rs`, executor, MCP toolkit `.cjs`) and specialists
stay — the executor's `spawn_agent` remains reachable from the MCP toolkit
for any agent pane that mounts it.

**D8 — One change, phased tasks.** Phase 0 spikes (interactive event shapes,
custom-agent format, ask-user driving), Phase 1 abstraction + settings +
launch/resume, Phase 2 observability, Phase 3 specialists, Phase 4 coordinator
removal. Spike findings are recorded in this design doc as amendments before
the dependent phase starts.

## Risks / Trade-offs

- [Copilot event schema is undocumented and versioned by a fast-moving CLI] →
  Tolerant parsing (unknown event types ignored, all fields optional — same
  posture `task.rs` takes toward Claude versions); a checked-in real
  `events.jsonl` fixture; `session.start.data.version` recorded and logged on
  mismatch.
- [Interactive-mode events may differ from the probed non-interactive run] →
  Phase 0 spike runs a real interactive session and captures the fixture
  before Phase 2 is built.
- [Ask-user TUI driving may be unreliable] → Capability-gated: if the spike
  can't produce a deterministic key sequence, Copilot panes surface the
  question and focus the pane instead of answering in-place.
- [No context % for Copilot] → Accepted product trade-off; footer renders
  model + activity without a meter (declared in the usage-dashboard delta).
- [Coordinator removal breaks operators who used it] → Deliberate product
  decision by the owner; removal is complete (no dead UI), specs updated.
- [`--no-auto-update` etc. flag drift across Copilot versions] → Launch args
  kept minimal (`--session-id`/`--resume`, `-C` not needed since PTY sets
  cwd, `--no-remote`); anything exotic stays out of the default launch.

## Open Questions

None remaining — all Phase 0 spikes resolved (see amendments below).

## Spike Findings (Phase 0 amendments)

**S1 — Event shapes (task 1.1), verified against Copilot CLI 1.0.80.**
Captured from real sessions into the checked-in fixture
`src-tauri/testdata/copilot-events-fixture.jsonl` (sanitized). Shapes:

- `tool.execution_start` — `data: { toolCallId, toolName, arguments,
  turnId, model, parentToolCallId? }`. `arguments` carries the tool input
  (e.g. `{command, description}` for `bash`); `parentToolCallId` is present
  when the call runs inside a subagent.
- `tool.execution_complete` — `data: { toolCallId, model, turnId, success,
  parentToolCallId? }`.
- `subagent.started` — `data: { toolCallId, agentName, agentDisplayName,
  agentDescription, model }`; `subagent.completed` adds `totalToolCalls`,
  `totalTokens`, `durationMs`.
- `assistant.message` — `data: { messageId, model, content, toolRequests[],
  outputTokens, turnId }`; `toolRequests[]` mirrors the pending tool calls
  with `intentionSummary`.
- `session.usage_checkpoint` — `data: { totalNanoAiu, totalPremiumRequests,
  modelCacheState[] }` (no context-window usage anywhere — confirms the
  no-context-% degradation).
- Turn/session lifecycle as previously probed: `session.start` (carries
  `data.version`, cwd/git context), `session.model_change`,
  `assistant.turn_start`/`turn_end`, `session.shutdown`.

**S2 — Custom agents (task 1.2): SUPPORTED.** A file at
`~/.copilot/agents/<name>.agent.md` with YAML frontmatter (`name`,
`description`, optional `model`, optional `tools`) and the persona as the
markdown body is picked up by `copilot --agent <name>` — verified end-to-end
(persona measurably applied). Specialists therefore translate cleanly:
body → agent body, `model` → frontmatter `model`, `tools` → frontmatter
`tools`. The app writes generated agents under `~/.copilot/agents/` with an
app-owned name prefix so it never touches the user's repo or their own agents.
`specialists` capability: **supported** for copilot.

**S3 — Ask-user driving (task 1.3): NOT SUPPORTED.** The Copilot TUI cannot
be exercised headlessly in this environment (it exits without a real
terminal), so menu driving cannot be validated. `askUserDriving: false` —
activating a Copilot pending-question alert focuses the pane. The ask-user
event itself is expected as `tool.execution_start` with `toolName:
"ask_user"` and the question in `arguments` (the envelope every tool uses);
tolerant parsing means a shape mismatch degrades to no alert, and the manual
smoke task validates it live.

**S4 — Busy markers (task 1.4): EMPTY SET.** Copilot panes are always
app-launched (the launcher is the only spawn path), so the events tailer is
always present and authoritative; no fallback marker strings are shipped
rather than guessing unverified TUI text. (Copilot also emits OSC 9;4
terminal-progress sequences — `terminalProgress` config — which a future
change could consume; out of scope here.)
