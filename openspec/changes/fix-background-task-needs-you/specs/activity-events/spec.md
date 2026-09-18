## MODIFIED Requirements

### Requirement: Capture Claude Hook Lifecycle Events
The system SHALL register a single hook script (`event-hook.cjs`) for app-launched Claude sessions, wired to `SessionStart`, `UserPromptSubmit`, `PreToolUse` (all tools), `PostToolUse` (all tools), `Notification`, `Stop`, `SubagentStop`, and `SessionEnd`, and SHALL normalize each invocation into an event carrying at minimum `paneId` (from `AGENT_DESKTOP_PANE`), `sessionId`, `hook_event_name`, and a timestamp. On `Stop` and `SubagentStop` the normalized event SHALL also carry the hook's `background_tasks` list, compacted to `{id, type, status, description}` per entry, when the hook payload provides one, and a `SubagentStop` SHALL also carry the finished agent's `agentId`; the backend SHALL persist and forward both unchanged.

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

#### Scenario: Background tasks carried on a turn end
- **WHEN** a `Stop` (or `SubagentStop`) hook fires with a `background_tasks` array
- **THEN** the emitted event carries `backgroundTasks` with each entry's `id`, `type`, `status`, and `description`
- **AND** when the payload has no `background_tasks` array the field is omitted

#### Scenario: Background tasks survive the durable sink
- **WHEN** a `Stop` event carrying `backgroundTasks` is recorded by the backend
- **THEN** the event read back from the ring and the durable sink still carries the same `backgroundTasks` list

#### Scenario: Subagent id carried on a subagent stop
- **WHEN** a `SubagentStop` hook fires with an `agent_id`
- **THEN** the emitted event carries it as `agentId` (omitted when absent, and never on other events)
