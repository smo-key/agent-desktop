## MODIFIED Requirements

### Requirement: Derive Session Status From Events
The system SHALL derive a session's status primarily from its hook events: `UserPromptSubmit` or a recent `PreToolUse`/`PostToolUse` yields `working`; a `Notification` indicating a wait/permission or a pending `AskUserQuestion` yields `waiting`; a `Stop` with no subsequent activity yields `waiting` (the turn is complete and the agent is at the prompt awaiting your input) — EXCEPT that a `Stop` whose `backgroundTasks` list still contains a LIVE AGENT-LIKE entry is NOT a completed turn: the session SHALL remain `working` (the agent will resume on its own when the background work reports back) with a current action naming that background work (description clipped), and SHALL return to `waiting` only on a later `Stop` with no such entry. An entry is live when its `status` is `running` or `pending`; it is agent-like when its `type` is `subagent`, `workflow`, `teammate`, or `cloud session` — background shells, monitors, and housekeeping tasks (`shell`, `monitor`, `dream`, `auto-mode scan`, `MCP task`) SHALL NOT count, because a dev server or watcher never exits and would pin the row In flight forever. A trailing `Notification` (the idle-prompt notice) behind such a `Stop` SHALL inherit its running state rather than flipping the session to `waiting`. A `SubagentStop` is NOT a turn boundary for the host pane — an in-process subagent finished while the parent's own turn state is unchanged — so when the most recent event is a `SubagentStop` and no tool is in flight, the status SHALL be that of the most recent NON-`SubagentStop` turn-boundary event (preserving the parent's settled `working`/`waiting` rather than dropping to the PTY fallback and flickering); only when there is no prior turn-boundary event at all SHALL it fall back to the PTY heuristic. A `Stop` with no `backgroundTasks` field (older claude, other backends, synthetic interrupts) SHALL classify exactly as before. A PTY `exit` SHALL remain authoritative for `finished`/`error` (with exit code), and the PTY-byte heuristic SHALL be used only as a fallback when no events determine a status.

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
- **WHEN** a `Stop` lists only `shell`, `monitor`, or housekeeping background tasks as running (or entries with no `type`)
- **THEN** the session status is `waiting`; only `subagent` / `workflow` / `teammate` / `cloud session` entries keep it `working`, and the current action names only those

#### Scenario: Pending background agents count as running
- **WHEN** a `Stop` lists an agent-like background task with `status` `pending`
- **THEN** the session status is `working`

#### Scenario: Idle notification inherits running background work
- **WHEN** a `Notification` arrives after a `Stop` that still lists a live agent-like background task (with only `SubagentStop`s in between)
- **THEN** the session stays `working`; a `Notification` behind a `Stop` with no such task still yields `waiting`

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
