## ADDED Requirements

### Requirement: Derive Session Status From Events
The system SHALL derive a session's status primarily from its hook events: `UserPromptSubmit` or a recent `PreToolUse`/`PostToolUse` yields `working`; a `Notification` indicating a wait/permission or a pending `AskUserQuestion` yields `waiting`; a `Stop`/`SubagentStop` with no subsequent activity yields `waiting` (the turn is complete and the agent is at the prompt awaiting your input). A PTY `exit` SHALL remain authoritative for `finished`/`error` (with exit code), and the PTY-byte heuristic SHALL be used only as a fallback when no events are available.

#### Scenario: Working from in-flight tool
- **WHEN** a `PreToolUse` event has been received with no matching `PostToolUse` yet
- **THEN** the session status is `working`

#### Scenario: Blocked from pending question
- **WHEN** a `PreToolUse[AskUserQuestion]` event is pending (no answer yet)
- **THEN** the session status is `waiting`/`blocked`

#### Scenario: Done from Stop
- **WHEN** a `Stop` event is the most recent event and no further activity follows
- **THEN** the session status is `waiting` (turn complete, awaiting your input) and the current action is cleared

#### Scenario: Exit is authoritative
- **WHEN** the PTY child exits with a non-zero code
- **THEN** the session status is `error` regardless of the last event

#### Scenario: Fallback when no events
- **WHEN** a session has produced no hook events yet
- **THEN** status is derived from the PTY-byte activity heuristic

### Requirement: User Interrupt Returns A Working Pane To Waiting
Interrupting (Esc) a mid-tool pane aborts the in-flight tool, but Claude emits no `PostToolUse` for the aborted tool and no `Stop`, so the event-sourced status would otherwise stay pinned at `working`. The system SHALL record a SYNTHETIC turn-end for an interrupted working pane so the derived status returns to `waiting` and the in-flight action clears. That synthetic turn-end SHALL be MARKED as frontend-only (not a genuine hook event) so consumers that distinguish a real return-to-user from an interrupt — notably task auto-archive — do not treat it as a completed turn. Interrupting a pane that is not working SHALL be a no-op.

#### Scenario: Interrupt returns a mid-tool working pane to waiting
- **WHEN** the user interrupts a pane that is mid-tool (a `PreToolUse` with no matching `PostToolUse`)
- **THEN** a synthetic turn-end is recorded, the derived status returns to `waiting`, the in-flight action clears, and the synthetic event is marked so task auto-archive does not treat it as a genuine return-to-user

#### Scenario: Interrupt is a no-op when the pane is not working
- **WHEN** the user interrupts a pane that is idle/waiting (no in-flight tool)
- **THEN** no synthetic turn-end is added and the timeline is unchanged

### Requirement: Surface Current Action
The system SHALL expose a `currentAction` label for each session equal to the `summary` of the latest `PreToolUse` event that has no matching `PostToolUse`, and SHALL clear it when the tool completes or the turn ends. `AgentRow` SHALL include this `currentAction` field.

#### Scenario: Current action reflects running tool
- **WHEN** a `PreToolUse` event with `summary = "Bash:npm test"` is in flight
- **THEN** the session's `currentAction` is `"Bash:npm test"`

#### Scenario: Current action cleared on completion
- **WHEN** the matching `PostToolUse` event arrives, or a `Stop` event ends the turn
- **THEN** the session's `currentAction` is `null`

### Requirement: Provide A Per-Tool Activity Timeline
The system SHALL maintain an ordered per-session activity timeline of tool events (each with tool name, input summary, and timestamp) sourced from the event store and seeded on mount from the durable sink. Seeding SHALL MERGE the durable snapshot into the live timeline rather than overwrite it: a frontend-only synthetic interrupt `Stop`, and any live event newer than the snapshot's last event, SHALL be preserved (the snapshot is authoritative only up to its own last timestamp).

#### Scenario: Timeline accumulates tool events
- **WHEN** a session runs `Read`, then `Edit`, then `Bash` in sequence
- **THEN** the timeline lists those three actions in order with their summaries and timestamps

#### Scenario: Timeline seeded on mount
- **WHEN** the overview mounts for a session that already has persisted events
- **THEN** the timeline is seeded from `events_for` before any new live event arrives

#### Scenario: Seed merge preserves a synthetic interrupt Stop
- **WHEN** the timeline is re-seeded from `events_for` and the durable snapshot lacks a frontend-only synthetic interrupt `Stop` that is already in the live timeline
- **THEN** the merge preserves that synthetic `Stop` so the interrupted pane is not re-pinned to `working`

#### Scenario: Seed merge preserves a live event newer than the snapshot
- **WHEN** a live event landed after the `events_for` snapshot was taken (a newer timestamp than the snapshot's last event)
- **THEN** the merge keeps that newer live event rather than dropping it

### Requirement: Trigger Transcript Content Reads From Events
The system SHALL read transcript-derived content (summary, context percentage) in response to `Stop` and `PostToolUse` events plus a slow safety poll (default ~5s), and SHALL NOT use a fixed 1.5s `activity_for` poll.

#### Scenario: Content refreshed on stop
- **WHEN** a `Stop` event is received for a pane
- **THEN** `activity_for` is invoked for that pane to refresh its summary and context percentage

#### Scenario: Safety poll backstops missed events
- **WHEN** no events have arrived for a pane within the safety interval
- **THEN** a slow poll (~5s) refreshes its transcript-derived content

#### Scenario: Fixed fast poll removed
- **WHEN** the overview is running
- **THEN** there is no fixed 1.5s `activity_for` polling loop driving content reads

### Requirement: Pending Question Sourced Primarily From Events
The system SHALL source the pending `AskUserQuestion` PRIMARILY from the `PreToolUse[AskUserQuestion]` event payload, taking precedence over any transcript-derived value. The `*.question.json` sidecar is no longer written (the question hook is retired) and its `read_pending_questions` reader has been removed from the activity reader: `activity_for_panes` now returns purely transcript-derived activity, and the live pending question (with its structured options) is sourced from the event pipeline on the frontend. The `agent-overview` capability's former "Pending question comes from the sidecar" scenario was reconciled to this event-sourced behavior when `add-agent-desktop` archived.

#### Scenario: Pending question shown from event
- **WHEN** a `PreToolUse[AskUserQuestion]` event is pending for a pane
- **THEN** the pane surfaces that question from the event payload, overriding any transcript value

#### Scenario: Question cleared on answer
- **WHEN** the corresponding `PostToolUse[AskUserQuestion]` or a `Stop` event arrives
- **THEN** the pending question derived from the event is cleared

### Requirement: Demote The Statusline Snapshot To Cost And Model Only
The system SHALL treat the statusline-wrapper snapshot as a non-critical source used only for running cost and model, such that no derived session status depends on the snapshot's presence or freshness.

#### Scenario: Status independent of snapshot
- **WHEN** a session's statusline snapshot is stale or absent
- **THEN** the session's status and `currentAction` are still derived from events with no degradation

#### Scenario: Cost and model still read from snapshot
- **WHEN** a snapshot is present
- **THEN** the session's cost and model are read from it as before
