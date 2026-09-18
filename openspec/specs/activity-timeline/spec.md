# activity-timeline Specification

## Purpose
TBD - created by archiving change add-activity-event-pipeline. Update Purpose after archive.
## Requirements
### Requirement: Derive Session Status From Events
The system SHALL derive a session's status primarily from its hook events: `UserPromptSubmit` or a recent `PreToolUse`/`PostToolUse` yields `working`; a `Notification` indicating a wait/permission or a pending `AskUserQuestion` yields `waiting`; a `Stop` with no subsequent activity yields `waiting` (the turn is complete and the agent is at the prompt awaiting your input) — EXCEPT that a `Stop` whose `backgroundTasks` list still contains a LIVE AGENT-LIKE entry is NOT a completed turn: the session SHALL remain `working` (the agent will resume on its own when the background work reports back) with a current action naming that background work (description clipped), and SHALL return to `waiting` only on a later `Stop` with no such entry. An entry is live when its `status` is `running` or `pending`; it is agent-like when its `type` is `subagent`, `workflow`, or `cloud session` — background shells, monitors, housekeeping tasks, and in-process teammates (`shell`, `monitor`, `dream`, `auto-mode scan`, `MCP task`, `teammate`) SHALL NOT count, because a dev server or watcher never exits and an idle teammate stays `running` with no hook on eviction, so either would pin the row In flight forever. A trailing `Notification` (the idle-prompt notice) SHALL inherit the running state of the `Stop` that ended the parent's turn, looking back past `SubagentStop`s, other notifications, and tool traffic (a background subagent's own tool events share the parent pane's timeline) but not past a `UserPromptSubmit` or session boundary (a synthetic interrupt turn-end that carries an outstanding list counts as that `Stop`), and counting only agents that have not reported `SubagentStop` before the notification — a `SubagentStop` trailing the notification is the wake-up gap and keeps the settled reading. A `SubagentStop` is NOT a turn boundary for the host pane — an in-process subagent finished while the parent's own turn state is unchanged — so when the most recent event is a `SubagentStop` and no tool is in flight, the status SHALL be that of the most recent NON-`SubagentStop` turn-boundary event (preserving the parent's settled `working`/`waiting` rather than dropping to the PTY fallback and flickering); only when there is no prior turn-boundary event at all SHALL it fall back to the PTY heuristic. A `Stop` with no `backgroundTasks` field (older claude, other backends, synthetic interrupts) SHALL classify exactly as before. A PTY `exit` SHALL remain authoritative for `finished`/`error` (with exit code), and the PTY-byte heuristic SHALL be used only as a fallback when no events determine a status.

#### Scenario: Working from in-flight tool
- **WHEN** a `PreToolUse` event has been received with no matching `PostToolUse` yet
- **THEN** the session status is `working`

#### Scenario: Blocked from pending question
- **WHEN** a `PreToolUse[AskUserQuestion]` event is pending (no answer yet)
- **THEN** the session status is `waiting`/`blocked`

#### Scenario: Done from Stop
- **WHEN** a `Stop` event is the most recent event and no further activity follows
- **THEN** the session status is `waiting` (turn complete, awaiting your input) and the current action is cleared

#### Scenario: Stop with running background tasks stays working
- **WHEN** a `Stop` event is the most recent event and its `backgroundTasks` contains an entry with `status` `running`
- **THEN** the session status is `working` and the current action names the background work, so the row is not laned as Needs you and no needs-input alert fires

#### Scenario: Background task finishing returns the session to waiting
- **WHEN** a `Stop` with running background tasks is followed by the background agent's `SubagentStop` and then a `Stop` whose `backgroundTasks` has no running entry
- **THEN** the session status is `waiting`

#### Scenario: Only agent-like background tasks keep the session working
- **WHEN** a `Stop` lists only `shell`, `monitor`, `teammate`, or housekeeping background tasks as running (or entries with no `type`)
- **THEN** the session status is `waiting`; only `subagent` / `workflow` / `cloud session` entries keep it `working`, and the current action names only those

#### Scenario: Pending background agents count as running
- **WHEN** a `Stop` lists an agent-like background task with `status` `pending`
- **THEN** the session status is `working`

#### Scenario: Idle notification inherits running background work
- **WHEN** a `Notification` arrives after a `Stop` that still lists a live agent-like background task, with only `SubagentStop`s, notifications, or (the subagent's) tool events in between and that agent not yet stopped
- **THEN** the session stays `working` (also when that turn end is a synthetic interrupt carrying the list, and when the agent's `SubagentStop` only arrives after the notification); a `Notification` behind a `Stop` with no such outstanding task, or after a new `UserPromptSubmit`, still yields `waiting`

#### Scenario: Long background descriptions are clipped in the current action
- **WHEN** the single running background task's description is longer than the label limit
- **THEN** the current action is clipped with an ellipsis

#### Scenario: Stop without a background task list classifies as before
- **WHEN** a `Stop` event carries no `backgroundTasks` field, an empty list, or entries none of which are `running`
- **THEN** the session status is `waiting`

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

### Requirement: User Interrupt Returns A Working Pane To Waiting
Interrupting (Esc) a mid-tool pane aborts the in-flight tool, but Claude emits no `PostToolUse` for the aborted tool and no `Stop`, so the event-sourced status would otherwise stay pinned at `working`. The system SHALL record a SYNTHETIC turn-end for an interrupted working pane so the derived status returns to `waiting` and the in-flight action clears. That synthetic turn-end SHALL be MARKED as frontend-only (not a genuine hook event) so consumers that distinguish a real return-to-user from an interrupt — notably task auto-archive — do not treat it as a completed turn. Interrupting a pane that is not working SHALL be a no-op. A pane that reads `working` only because its last `Stop` still lists running background tasks (nothing in flight) SHALL also treat an interrupt as a no-op — the prompt is free and Esc aborts nothing. When a tool IS in flight and background agents are still OUTSTANDING — the last real `Stop`'s live agent-like entries minus any whose `SubagentStop` has since arrived — the synthetic turn-end SHALL carry that outstanding list forward so the pane stays `working` on that background work rather than flipping to `waiting`. A finished agent SHALL never be carried forward: when nothing is outstanding the interrupt injects a plain turn-end (→ `waiting`), even if the last boundary was a `Stop` that listed the now-finished agent.

#### Scenario: Interrupt returns a mid-tool working pane to waiting
- **WHEN** the user interrupts a pane that is mid-tool (a `PreToolUse` with no matching `PostToolUse`)
- **THEN** a synthetic turn-end is recorded, the derived status returns to `waiting`, the in-flight action clears, and the synthetic event is marked so task auto-archive does not treat it as a genuine return-to-user

#### Scenario: Interrupt is a no-op when the pane is not working
- **WHEN** the user interrupts a pane that is idle/waiting (no in-flight tool)
- **THEN** no synthetic turn-end is added and the timeline is unchanged

#### Scenario: Interrupt is a no-op while only background work is running
- **WHEN** the user interrupts a pane whose most recent turn boundary is a `Stop` that still lists a running background task (no tool in flight)
- **THEN** no synthetic turn-end is added and the pane stays `working` on the background work

#### Scenario: Interrupt keeps background work In flight
- **WHEN** the user interrupts a pane that is mid-tool while its last real `Stop` still lists a running background task
- **THEN** the synthetic turn-end carries that running list, the aborted tool clears, and the pane stays `working` with the background work as its current action

#### Scenario: Interrupt after the background agent finished returns to waiting
- **WHEN** a `Stop` listed a running background agent, that agent's `SubagentStop` (carrying its `agentId`) has since arrived, and the user interrupts — whether the parent has already begun a tool or emitted nothing yet
- **THEN** the synthetic turn-end carries no finished agent (only agents still outstanding, if any) and the pane returns to `waiting` when none remain

### Requirement: Surface Current Action
The system SHALL expose a `currentAction` label for each session equal to the `summary` of the latest `PreToolUse` event that has no matching `PostToolUse`, and SHALL clear it when the tool completes or the turn ends. `AgentRow` SHALL include this `currentAction` field.

#### Scenario: Current action reflects running tool
- **WHEN** a `PreToolUse` event with `summary = "Bash:npm test"` is in flight
- **THEN** the session's `currentAction` is `"Bash:npm test"`

#### Scenario: Current action cleared on completion
- **WHEN** the matching `PostToolUse` event arrives, or a `Stop` event ends the turn
- **THEN** the session's `currentAction` is `null`

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

### Requirement: Event Timeline Self-Heals Via Periodic Reconciliation
The system SHALL periodically re-seed the event timeline from the durable sink (`events_for`) on a slow safety interval (default ~5s), in addition to re-seeding when the app's session set changes, so a frontend timeline that missed a live `overview://event` push reconciles with the authoritative durable sink within the interval rather than remaining diverged indefinitely. The periodic re-seed SHALL use the same merge semantics as mount/resume seeding (preserving live events newer than the snapshot, and a synthetic interrupt `Stop` only while it is the newest event).

#### Scenario: A missed live event reconciles on the next safety re-seed
- **WHEN** the durable sink has recorded events that the frontend event timeline missed (e.g. a dropped live push), leaving the derived status stale
- **THEN** the next periodic safety re-seed merges the missing events in and the derived status reflects them within the interval

#### Scenario: Periodic re-seed does not disturb a current timeline
- **WHEN** the frontend event timeline is already in sync with the durable sink and a periodic safety re-seed runs
- **THEN** the merge is idempotent — no events are duplicated and a still-newest synthetic interrupt `Stop` is retained

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


