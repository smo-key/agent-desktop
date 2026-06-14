## MODIFIED Requirements

### Requirement: Spawn new agents
The toolkit SHALL let the orchestrator spawn a new `claude` agent pane in its
project with a given initial prompt and an optional working directory within the
project. The new agent's identity SHALL be returned to the orchestrator.
`spawn_agent` SHALL accept an optional `notifyOnComplete` boolean that defaults to
`true`, and the system SHALL persist its value on the spawned agent's pane so the
completion watch can read it. Every spawned agent SHALL be launched with an MCP
configuration that exposes the `message_coordinator` tool (and only that tool),
carrying the new agent's own pane identity and its spawning coordinator's pane
identity.

#### Scenario: Orchestrator spawns an agent
- **WHEN** the orchestrator calls `spawn_agent` with a prompt
- **THEN** a new agent pane is launched in the orchestrator's project with that prompt as its initial input
- **AND** the new agent's identity is returned to the orchestrator

#### Scenario: Spawn defaults to notify-on-complete
- **WHEN** the orchestrator calls `spawn_agent` without specifying `notifyOnComplete`
- **THEN** the spawned pane is marked notify-on-complete (default `true`)

#### Scenario: Spawn opts out of completion notifications
- **WHEN** the orchestrator calls `spawn_agent` with `notifyOnComplete: false`
- **THEN** the spawned pane is marked so it does not notify the coordinator on completion

#### Scenario: Spawned agent can message its coordinator
- **WHEN** an agent is spawned by the orchestrator
- **THEN** it is launched with an MCP configuration exposing the `message_coordinator` tool, bound to its own pane and to its spawning coordinator

## ADDED Requirements

### Requirement: Agents can message their coordinator
The toolkit SHALL expose a `message_coordinator` operation, invoked by a spawned
agent, that delivers the agent's text as an update to its coordinator. The
operation SHALL route to the coordinator that spawned the agent, falling back to
the agent's project coordinator, and SHALL identify the originating agent. When no
coordinator is running for the agent's project, the operation SHALL return a
structured error rather than delivering anything. `message_coordinator` is exposed
to spawned agents only and is not part of the coordinator's own toolkit.

#### Scenario: Agent messages its coordinator
- **WHEN** a spawned agent calls `message_coordinator` with text and its project has a running coordinator
- **THEN** the text is delivered to that coordinator as an update attributed to the originating agent

#### Scenario: Agent message routes to the spawning coordinator
- **WHEN** a spawned agent calls `message_coordinator` and a coordinator that spawned it is running
- **THEN** the update is routed to that spawning coordinator

#### Scenario: No coordinator running
- **WHEN** a spawned agent calls `message_coordinator` and no coordinator is running for its project
- **THEN** the operation returns a structured error and nothing is delivered
