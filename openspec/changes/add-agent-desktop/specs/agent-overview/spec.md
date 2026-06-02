## ADDED Requirements

### Requirement: Agent Roster Overview
The system SHALL provide an Overview surface that lists every running agent (each terminal pane running a Claude session) with its name/cwd, model, current task, context percentage, cost, and a live/idle/needs-attention status, derived from each agent's latest usage snapshot.

#### Scenario: Roster reflects running agents
- **WHEN** the overview is shown and one or more panes are running Claude sessions
- **THEN** it lists one entry per agent showing that agent's model, current task (the in-progress `activeForm`), context percentage, and cost taken from its latest snapshot

#### Scenario: Agent status derives from heartbeat and activity
- **WHEN** an agent's latest snapshot heartbeat is fresh
- **THEN** its status is `live`
- **AND** when the heartbeat is older than the idle threshold its status is `idle`
- **AND** when it is alive but has had no in-progress task and no snapshot update for the attention threshold its status is `needs-attention`

### Requirement: Navigate To An Agent
The system SHALL let the user open an agent from the overview, switching to the terminal grid with that agent's workspace active and its pane focused.

#### Scenario: Selecting an agent focuses its pane
- **WHEN** the user activates an agent entry in the overview
- **THEN** the app switches to the terminal-grid view, activates that agent's workspace, and focuses that agent's pane

### Requirement: Message An Agent
The system SHALL let the user send text to any agent's terminal from the overview without navigating to its pane, delivering the exact text to that agent's PTY.

#### Scenario: Sending a message writes to the agent PTY
- **WHEN** the user submits a message for an agent from the overview
- **THEN** the exact text followed by a single carriage return is written to that agent's PTY via the existing terminal write path

#### Scenario: Only user-entered text is ever sent
- **WHEN** the app delivers any input to an agent (an overview message or a launch-time initial prompt)
- **THEN** it transmits only text the user entered and never synthesizes a slash command or other input on the user's behalf

### Requirement: Kick Off A New Agent From The Overview
The system SHALL provide a "new agent" action in the overview that opens the session launcher, and the agent created through it SHALL appear in the overview roster.

#### Scenario: New-agent action launches and rosters
- **WHEN** the user triggers "new agent" in the overview and completes the launcher
- **THEN** a new Claude session starts in the chosen folder and a corresponding agent entry appears in the overview roster

### Requirement: Surface Subagents
The system SHALL surface subagents that an app agent spawns (Task-tool agents and workflow agents) under their parent agent, read from the parent session's workflow run records and per-subagent metadata under `~/.claude/projects/<project>/<session>/`, and SHALL tolerate absent or partial metadata.

#### Scenario: Subagents appear under their parent agent
- **WHEN** an app agent's session has spawned subagents recorded under its project session directory (`workflows/<id>.json` and `subagents/**/agent-*.meta.json`)
- **THEN** each subagent is listed under that parent agent with its label and status

#### Scenario: Partial subagent metadata does not break the roster
- **WHEN** a subagent metadata record is missing fields or is malformed
- **THEN** that record is skipped or shown with only its available fields, and the rest of the roster is unaffected

### Requirement: Agent Usage Tracking
The system SHALL track usage per agent (cost, context percentage, and token counts where available) and SHALL show an aggregate usage total across all agents and their subagents.

#### Scenario: Per-agent usage reflects the snapshot
- **WHEN** an agent has a latest snapshot
- **THEN** its displayed usage reflects that snapshot's cost and context percentage

#### Scenario: Aggregate usage sums agents and subagents
- **WHEN** the overview computes the usage total
- **THEN** it sums each agent's cost together with each available subagent's recorded usage, ignoring records whose usage is unavailable

### Requirement: Overview As A Primary View
The system SHALL present the overview as a primary top-level view that the user can switch to and from the terminal grid.

#### Scenario: Toggle between overview and grid
- **WHEN** the user switches the top-level view
- **THEN** the overview and the terminal grid alternate
- **AND** choosing an agent from the overview lands on the grid focused on that agent
