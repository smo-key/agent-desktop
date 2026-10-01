## ADDED Requirements

### Requirement: Paused Agents Do Not Run Until Opened
A paused agent that can be resumed (a claude-family program with a session id) SHALL NOT have a running process unless the user has opened it. Pausing such an agent SHALL terminate its process (asking for confirmation first when the agent is `working`) while keeping it in the Paused lane, and a paused agent known to hold a user message SHALL restore DORMANT on app launch (not spawned). Opening a dormant paused agent SHALL respawn it with `claude --resume`, keeping it Paused until the user sends a new message or resumes it; a woken paused agent the user leaves SHALL return to dormant after the archived-preview grace period, unless it is working. A dormant pane SHALL be excluded from live polling, and orchestration SHALL refuse to message it. A paused pane that cannot be resumed (no session id) or whose session is still EMPTY (no user message yet, so no transcript exists to resume) SHALL keep running. Archiving a dormant paused agent SHALL clear its dormant state so a later preview or restore spawns it, and a dormant agent SHALL report `idle` rather than a stale pre-pause status. The dormant state is runtime-only and is never persisted.

#### Scenario: Pausing an agent stops its process
- **WHEN** a live claude agent with a session id is paused
- **THEN** it is paused and dormant (no PTY), is excluded from the live pane refs, and is marked to resume its session when next spawned

#### Scenario: A paused agent without a session id keeps running
- **WHEN** a pane that has no session id is paused
- **THEN** it is paused but not dormant, so its process keeps running

#### Scenario: Pausing an empty session keeps it running
- **WHEN** a claude agent with a session id but no user message yet is paused
- **THEN** it is paused but not dormant, since `claude --resume` would have no transcript to resume

#### Scenario: A paused agent restores dormant
- **WHEN** a layout holding a paused claude agent is serialized and restored
- **THEN** the restored pane is paused and dormant with resume set, and the serialized form carries no dormant flag

#### Scenario: Opening a paused agent resumes its session
- **WHEN** a dormant paused agent is woken (opened)
- **THEN** it is no longer dormant, will spawn with `claude --resume`, and is still paused with its baseline count intact

#### Scenario: Resuming a paused agent wakes it
- **WHEN** a dormant paused agent is resumed (Resume pressed, or a new message detected)
- **THEN** it is neither paused nor dormant

#### Scenario: A woken paused agent sleeps again after the user leaves
- **WHEN** the shown agent is not a woken paused agent and a woken paused agent exists
- **THEN** that agent is a grace-timer target (as a previewing archived agent is), while the shown one and dormant ones are not; and putting it to sleep makes it dormant again while staying paused

#### Scenario: Pausing a working agent asks for confirmation
- **WHEN** the user pauses an agent whose status is working
- **THEN** a confirmation is requested before its process is stopped; pausing a non-working agent needs no confirmation
