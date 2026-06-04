## ADDED Requirements

### Requirement: Capture Claude Hook Lifecycle Events
The system SHALL register a single hook script (`event-hook.cjs`) for app-launched Claude sessions, wired to `SessionStart`, `UserPromptSubmit`, `PreToolUse` (all tools), `PostToolUse` (all tools), `Notification`, `Stop`, `SubagentStop`, and `SessionEnd`, and SHALL normalize each invocation into an event carrying at minimum `paneId` (from `AGENT_DESKTOP_PANE`), `sessionId`, `hook_event_name`, and a timestamp.

#### Scenario: Full event set registered at spawn
- **WHEN** `buildSpawnOverride` constructs the per-session `--settings` for a `claude` pane
- **THEN** `settings.hooks` registers `event-hook.js` for each of `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStop`, and `SessionEnd`
- **AND** the `PreToolUse` and `PostToolUse` matchers select all tools
- **AND** the injected env includes `AGENT_DESKTOP_SOCKET_PATH`

#### Scenario: Tool event summarized
- **WHEN** a `PreToolUse` hook fires for a tool
- **THEN** the emitted event includes `tool_name` and a short `summary` derived from the key input (e.g. `Bash:<command head>`, `Edit:<basename(file_path)>`, `Task:<subagent_type>`, MCP → tool name)
- **AND** when the input shape is unrecognized the `summary` falls back to `tool_name`

#### Scenario: Pending question carried on the event
- **WHEN** a `PreToolUse` hook fires for the `AskUserQuestion` tool
- **THEN** the emitted event carries the structured question payload (header, prompt, multiSelect, options)

### Requirement: Deliver Events Without Blocking Claude
The hook script SHALL connect to the Unix-domain socket at `AGENT_DESKTOP_SOCKET_PATH`, write the event as a single JSON line, and exit `0`, and SHALL swallow every error (including a connect timeout) so that a missing, stale, or closed socket never blocks or delays the Claude turn.

#### Scenario: Socket absent does not block the turn
- **WHEN** the hook fires but no process is listening on `AGENT_DESKTOP_SOCKET_PATH`
- **THEN** the hook exits `0` within its connect timeout without writing to stderr in a way that surfaces in the session
- **AND** the Claude turn proceeds unaffected

#### Scenario: Event delivered as one line
- **WHEN** the hook connects successfully
- **THEN** it writes exactly one newline-terminated JSON object and closes the connection

### Requirement: Host The Event Socket In The Backend
The system SHALL host a Unix-domain socket in the Tauri backend that, on startup, removes any stale socket file and listens at a path exposed to the frontend via `usage_paths` as `socket_path`; for each accepted connection it SHALL read a JSON line, parse it into an event, stamp a receive-time, push it to a bounded per-pane in-memory ring buffer, and emit a Tauri `overview://event`.

#### Scenario: Accepted event is emitted and buffered
- **WHEN** a well-formed JSON event line is received on the socket
- **THEN** the backend emits an `overview://event` carrying the parsed event
- **AND** appends it to the per-pane ring buffer keyed by `paneId`

#### Scenario: Malformed line is dropped
- **WHEN** a received line is not valid JSON or lacks required fields
- **THEN** the backend drops it without crashing the accept loop and continues serving subsequent connections

#### Scenario: Stale socket recreated on boot
- **WHEN** the backend starts and a socket file already exists at the configured path
- **THEN** it unlinks the stale file and binds a fresh listener

### Requirement: Persist Events To A Durable Per-Session Sink
The system SHALL append every received event to a durable JSONL sink at `events/<sessionId>.jsonl` under the app data directory, keyed by `sessionId`, so that the activity timeline is recoverable independent of the in-memory ring buffer.

#### Scenario: Event appended to the session sink
- **WHEN** the backend receives an event with `sessionId = S`
- **THEN** the event is appended as one JSON line to `events/S.jsonl`

#### Scenario: Sink keyed by sessionId matches the transcript
- **WHEN** events for two panes sharing a working directory but with distinct `sessionId` values are received
- **THEN** each is written to its own `events/<sessionId>.jsonl` with no cross-contamination

### Requirement: Prune The Event Sink By Age And Size
The system SHALL bound the durable sink by pruning, on startup, event logs for sessions not modified within a retention window (default 30 days), and by capping any single session log at a maximum size (default ~5MB) by truncating from the head; both thresholds SHALL be configurable.

#### Scenario: Old session log pruned
- **WHEN** the backend starts and `events/<sessionId>.jsonl` was last modified beyond the retention window
- **THEN** that log file is removed

#### Scenario: Oversized log truncated from the head
- **WHEN** a session log exceeds the per-session size cap
- **THEN** the oldest lines are removed so the file returns within the cap while preserving the most recent events

### Requirement: Rehydrate The Timeline On Startup And Resume
The system SHALL provide an `events_for` command that seeds a pane's timeline from the per-session sink (falling back to the in-memory ring), and SHALL backfill a completed-tool timeline by parsing `tool_use`/`tool_result` blocks from the transcript for sessions that have no durable sink yet.

#### Scenario: Resume shows prior timeline
- **WHEN** a session is reopened via `claude --resume <sessionId>` and `events/<sessionId>.jsonl` exists
- **THEN** `events_for` returns the persisted events and the pane shows the prior tool timeline rather than an empty panel

#### Scenario: Backfill for pre-existing sessions
- **WHEN** a session has a transcript but no `events/<sessionId>.jsonl`
- **THEN** the system reconstructs a completed-tool timeline from the transcript's `tool_use`/`tool_result` blocks on first open
