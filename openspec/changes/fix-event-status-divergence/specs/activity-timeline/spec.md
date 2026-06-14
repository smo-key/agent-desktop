# activity-timeline Specification (delta)

## MODIFIED Requirements

### Requirement: Derive Session Status From Events
The system SHALL derive a session's status primarily from its hook events: `UserPromptSubmit` or a recent `PreToolUse`/`PostToolUse` yields `working`; a `Notification` indicating a wait/permission or a pending `AskUserQuestion` yields `waiting`; a `Stop` with no subsequent activity yields `waiting` (the turn is complete and the agent is at the prompt awaiting your input). A `SubagentStop` is NOT a turn boundary for the host pane — an in-process subagent finished while the parent's own turn state is unchanged — so when the most recent event is a `SubagentStop` and no tool is in flight, the status SHALL be that of the most recent NON-`SubagentStop` turn-boundary event (preserving the parent's settled `working`/`waiting` rather than dropping to the PTY fallback and flickering); only when there is no prior turn-boundary event at all SHALL it fall back to the PTY heuristic. A PTY `exit` SHALL remain authoritative for `finished`/`error` (with exit code), and the PTY-byte heuristic SHALL be used only as a fallback when no events determine a status.

#### Scenario: Working from in-flight tool
- **WHEN** a `PreToolUse` event has been received with no matching `PostToolUse` yet
- **THEN** the session status is `working`

#### Scenario: Blocked from pending question
- **WHEN** a `PreToolUse[AskUserQuestion]` event is pending (no answer yet)
- **THEN** the session status is `waiting`/`blocked`

#### Scenario: Done from Stop
- **WHEN** a `Stop` event is the most recent event and no further activity follows
- **THEN** the session status is `waiting` (turn complete, awaiting your input) and the current action is cleared

#### Scenario: Trailing SubagentStop preserves a completed turn as waiting
- **WHEN** a `Stop` established `waiting` for a pane and a later background `SubagentStop` is the most recent event with no tool in flight
- **THEN** the status stays `waiting` (the settled turn-boundary status is preserved) rather than dropping to the PTY fallback and bouncing

#### Scenario: Trailing SubagentStop preserves a working turn
- **WHEN** the most recent turn-boundary event was a `PostToolUse` (status `working`) and a `SubagentStop` follows with no tool in flight
- **THEN** the status stays `working` (the prior boundary is preserved; a finishing subagent does not flip the parent to waiting)

#### Scenario: Exit is authoritative
- **WHEN** the PTY child exits with a non-zero code
- **THEN** the session status is `error` regardless of the last event

#### Scenario: Fallback when no events
- **WHEN** a session has produced no hook events yet
- **THEN** status is derived from the PTY-byte activity heuristic

### Requirement: Provide A Per-Tool Activity Timeline
The system SHALL maintain an ordered per-session activity timeline of tool events (each with tool name, input summary, and timestamp) sourced from the event store and seeded on mount from the durable sink. Seeding SHALL MERGE the durable snapshot into the live timeline rather than overwrite it: any live event newer than the snapshot's last event SHALL be preserved, and a frontend-only synthetic interrupt `Stop` SHALL be preserved ONLY WHEN it is newer than the snapshot's last event (the snapshot is authoritative up to its own last timestamp). A synthetic interrupt `Stop` that the durable snapshot has SUPERSEDED with a newer real event SHALL be dropped on merge, so a re-seed corrects a pane whose interrupt did not actually stop it; a synthetic `Stop` that remains the newest event (a genuine interrupt with no later real activity) SHALL be preserved.

#### Scenario: Timeline accumulates tool events
- **WHEN** a session runs `Read`, then `Edit`, then `Bash` in sequence
- **THEN** the timeline lists those three actions in order with their summaries and timestamps

#### Scenario: Timeline seeded on mount
- **WHEN** the overview mounts for a session that already has persisted events
- **THEN** the timeline is seeded from `events_for` before any new live event arrives

#### Scenario: Seed merge preserves a synthetic interrupt Stop
- **WHEN** the timeline is re-seeded from `events_for` and the live timeline holds a frontend-only synthetic interrupt `Stop` that is still newer than the durable snapshot's last event (no real activity followed the interrupt)
- **THEN** the merge preserves that synthetic `Stop` so the interrupted pane is not re-pinned to `working`

#### Scenario: Seed merge drops a superseded synthetic interrupt Stop
- **WHEN** the timeline is re-seeded from `events_for` and the durable snapshot contains a real event NEWER than the live timeline's synthetic interrupt `Stop` (the agent produced turn activity after the interrupt)
- **THEN** the merge drops the synthetic `Stop` so the pane reflects the real working tail rather than staying pinned at `waiting`

#### Scenario: Seed merge preserves a live event newer than the snapshot
- **WHEN** a live event landed after the `events_for` snapshot was taken (a newer timestamp than the snapshot's last event)
- **THEN** the merge keeps that newer live event rather than dropping it

## ADDED Requirements

### Requirement: Event Timeline Self-Heals Via Periodic Reconciliation
The system SHALL periodically re-seed the event timeline from the durable sink (`events_for`) on a slow safety interval (default ~5s), in addition to re-seeding when the app's session set changes, so a frontend timeline that missed a live `overview://event` push reconciles with the authoritative durable sink within the interval rather than remaining diverged indefinitely. The periodic re-seed SHALL use the same merge semantics as mount/resume seeding (preserving live events newer than the snapshot, and a synthetic interrupt `Stop` only while it is the newest event).

#### Scenario: A missed live event reconciles on the next safety re-seed
- **WHEN** the durable sink has recorded events that the frontend event timeline missed (e.g. a dropped live push), leaving the derived status stale
- **THEN** the next periodic safety re-seed merges the missing events in and the derived status reflects them within the interval

#### Scenario: Periodic re-seed does not disturb a current timeline
- **WHEN** the frontend event timeline is already in sync with the durable sink and a periodic safety re-seed runs
- **THEN** the merge is idempotent — no events are duplicated and a still-newest synthetic interrupt `Stop` is retained
