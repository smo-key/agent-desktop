## ADDED Requirements

### Requirement: Backend-specific sources feed one event pipeline
The activity event pipeline SHALL accept events from backend-specific producers
(in-memory ring, durable per-session JSONL sink, timeline rehydration), not
only the Claude hook socket: Copilot sessions' events derived from their
session event log SHALL be normalized into the same event shape (`paneId`,
`sessionId`, event name, timestamp, optional tool summary / question payload)
and flow through the same buffering, persistence, and pruning rules.

#### Scenario: Copilot events reach the timeline
- **WHEN** the Copilot event tailer translates a tool-call event for pane `P`, session `S`
- **THEN** the event is buffered in `P`'s ring, appended to `events/S.jsonl`, and appears in the pane's activity timeline like a Claude hook event would

#### Scenario: Rehydration is backend-agnostic
- **WHEN** the app restarts with persisted event sinks for a Claude session and a Copilot session
- **THEN** both panes' timelines rehydrate from their sinks by `sessionId` with no backend-specific casing in the rehydration path
