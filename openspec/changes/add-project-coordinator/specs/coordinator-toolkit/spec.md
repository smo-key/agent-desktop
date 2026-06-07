## ADDED Requirements

### Requirement: Toolkit exposed to the coordinator over MCP
The system SHALL expose the coordinator's agent-management toolkit to the
coordinator session as MCP tools via a bundled stdio MCP adapter. Each tool call
SHALL be carried over the app control channel to the executor that owns the pane
registry and SHALL return a result to the coordinator.

#### Scenario: Coordinator invokes a toolkit tool
- **WHEN** the coordinator invokes a toolkit tool
- **THEN** the call is carried to the executor, performed, and a result is returned to the coordinator

### Requirement: Spawn new agents
The toolkit SHALL let the coordinator spawn a new `claude` agent in its project
with a given initial prompt (and optional working directory within the project).

#### Scenario: Coordinator spawns an agent
- **WHEN** the coordinator calls `spawn_agent` with a prompt
- **THEN** a new agent pane is launched in the coordinator's project with that prompt as its initial input
- **AND** the new agent's identity is returned to the coordinator

### Requirement: Message and read existing agents
The toolkit SHALL let the coordinator send input to a running agent
(`message_agent`) and read that agent's recent output / state (`read_agent`).

#### Scenario: Coordinator messages an agent
- **WHEN** the coordinator calls `message_agent` for a running agent in its project with text
- **THEN** the text is delivered as input to that agent's session

#### Scenario: Coordinator reads an agent
- **WHEN** the coordinator calls `read_agent` for an agent in its project
- **THEN** the agent's recent output / activity is returned to the coordinator

### Requirement: Answer an agent's pending question
The toolkit SHALL let the coordinator resolve a waiting agent's pending question
(`answer_question`) by selecting an option or supplying text, unblocking that
agent — subject to the escalation guardrails.

#### Scenario: Coordinator answers a pending question
- **WHEN** the coordinator calls `answer_question` for an agent with a non-guardrailed pending question
- **THEN** the agent's question is resolved with the coordinator's answer and the agent is unblocked

#### Scenario: Answer refused for a guardrailed item
- **WHEN** the coordinator calls `answer_question` for an item matching the hard guardrail set
- **THEN** the call is refused and the item is forced to the human

### Requirement: List and inspect agents
The toolkit SHALL let the coordinator enumerate the agents in its project
(`list_agents`) and inspect an individual agent's status/activity
(`inspect_agent`).

#### Scenario: Coordinator lists agents
- **WHEN** the coordinator calls `list_agents`
- **THEN** the agents belonging to the coordinator's project are returned with their status

#### Scenario: Coordinator inspects an agent
- **WHEN** the coordinator calls `inspect_agent` for an agent in its project
- **THEN** that agent's status and activity are returned

### Requirement: Archive and unarchive agents
The toolkit SHALL let the coordinator archive (`archive_agent`) and unarchive
(`unarchive_agent`) agents in its project.

#### Scenario: Coordinator archives an agent
- **WHEN** the coordinator calls `archive_agent` for an agent in its project
- **THEN** that agent is archived

### Requirement: All toolkit operations are project-scoped
Every toolkit operation SHALL be bounded to the coordinator's project. A call
targeting a pane outside the coordinator's project, or a closed/nonexistent pane,
SHALL be rejected.

#### Scenario: Cross-project target rejected
- **WHEN** the coordinator calls a toolkit tool targeting a pane that does not belong to its project
- **THEN** the call is rejected and no action is taken

#### Scenario: Invalid target rejected
- **WHEN** the coordinator targets a closed or nonexistent pane
- **THEN** the call is rejected
