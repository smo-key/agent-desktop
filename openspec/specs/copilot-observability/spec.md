# copilot-observability Specification

## Purpose
Observe app-launched Copilot sessions by tailing their session event logs, feeding the app's status, activity, usage, title, and subagent pipelines without Claude-specific hooks.
## Requirements
### Requirement: Tail the Copilot session event log
For every app-launched Copilot pane, the system SHALL locate
`~/.copilot/session-state/<session-id>/events.jsonl` directly by the
app-minted session UUID and SHALL tail it incrementally (file-watch driven,
reading only appended bytes), translating recognized events into the app's
existing status, activity, usage, and title pipelines. Parsing SHALL be
version-tolerant: unknown event types and missing fields are ignored without
error, and the `session.start` schema version is recorded for diagnostics.

#### Scenario: Session directory found by UUID
- **WHEN** a Copilot pane is spawned with app-minted UUID `S`
- **THEN** the tailer watches `~/.copilot/session-state/S/events.jsonl`, beginning when the file appears

#### Scenario: Unknown events are skipped
- **WHEN** the event log contains an event type the app does not recognize
- **THEN** the tailer skips it and continues; no error surfaces and known events around it are still applied

#### Scenario: Missing session state degrades to a plain pane
- **WHEN** no session-state directory ever appears for a Copilot pane (e.g. a CLI too old to write one)
- **THEN** the pane keeps working as a terminal pane with launch/prompt/placement intact, and observability-derived chrome simply stays absent

### Requirement: Busy and idle status from turn events
The system SHALL derive a Copilot pane's working state from turn lifecycle
events: an `assistant.turn_start` marks the pane actively working, and an
`assistant.turn_end` or `session.shutdown` returns it to idle, feeding the
same status-derivation inputs used for Claude panes. Terminal busy-marker
scanning with Copilot's own affordance strings SHALL remain the fallback
signal.

#### Scenario: Turn in flight reads Working
- **WHEN** a Copilot pane's event log records `assistant.turn_start` with no subsequent `assistant.turn_end`
- **THEN** the pane derives as Working (In flight) in the roster

#### Scenario: Turn end returns to idle
- **WHEN** `assistant.turn_end` is recorded and no new turn starts
- **THEN** the pane leaves Working and derives idle (or Needs input if a question is pending)

### Requirement: Pending questions from ask-user tool requests
WHEN a Copilot event records an ask-user tool request, the system SHALL
surface it as a pending question (needs-input alert with the question
payload) exactly as a Claude `AskUserQuestion` event would be surfaced. WHEN
in-TUI answering is not declared for the backend, activating the alert SHALL
focus the pane with the question visible rather than answering in-place.

#### Scenario: Ask-user surfaces as Needs input
- **WHEN** the event log records the agent invoking its ask-user tool with a question
- **THEN** the pane derives Needs input and the alert carries the question text (and options when present)

#### Scenario: Activation focuses the pane when driving is unsupported
- **WHEN** the operator activates the pending-question alert for a Copilot pane and the backend does not declare in-TUI question answering
- **THEN** the app focuses the pane so the operator can answer directly in the terminal

### Requirement: Usage snapshots from Copilot events
The system SHALL produce usage snapshots for Copilot panes from the event
log — at minimum the current model id (from `session.model_change` /
`assistant.message`) and accumulated output tokens or usage checkpoints —
written in the same app-owned snapshot form the usage pipeline already
consumes, with Claude-only fields (context percentage, rate limits) absent.

#### Scenario: Footer model pill for a Copilot pane
- **WHEN** a Copilot session's events record model `gpt-5`
- **THEN** the focused-pane footer shows a backend-formatted model label for `gpt-5`, and the context meter is absent

### Requirement: Titles, timeline, and subagent rows from events
The system SHALL feed Copilot user/assistant message text into the existing
local title generation, SHALL map tool-call events into the activity
timeline's event vocabulary, and SHALL derive subagent rows from Copilot
subagent lifecycle events when the pane's subagent view is enabled.

#### Scenario: Auto-title from Copilot transcript
- **WHEN** a Copilot session accumulates user messages
- **THEN** on-device auto-titling runs over that text under the same constraints as Claude sessions

#### Scenario: Tool call appears in the timeline
- **WHEN** the event log records a tool call
- **THEN** the pane's activity timeline shows an entry summarizing the tool and its key input

#### Scenario: Subagent start surfaces a row
- **WHEN** the event log records a subagent starting under the session
- **THEN** a subagent row appears for the pane (and completes/clears on the corresponding terminal event)
