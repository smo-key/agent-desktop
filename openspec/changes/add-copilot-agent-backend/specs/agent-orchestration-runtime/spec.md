## MODIFIED Requirements

### Requirement: Spawn new agents
The toolkit SHALL let the orchestrator spawn a new agent pane (the backend
resolved by the app's agent-backends registry) in its project with a given
initial prompt and an optional working directory within the project. The new
agent's identity SHALL be returned to the orchestrator.

#### Scenario: Orchestrator spawns an agent
- **WHEN** the orchestrator calls `spawn_agent` with a prompt
- **THEN** a new agent pane is launched in the orchestrator's project with that prompt as its initial input
- **AND** the new agent's identity is returned to the orchestrator

### Requirement: List and inspect project agents
The toolkit SHALL let the orchestrator enumerate the project's agent panes
(`list_agents`) and inspect a single agent (`inspect_agent`). `list_agents` SHALL
return every agent pane in the project — both orchestrator-spawned agents
and the user's manually-started sessions.

#### Scenario: Listing returns all project agents
- **WHEN** the orchestrator calls `list_agents`
- **THEN** every agent pane in the orchestrator's project is returned, including the user's pre-existing sessions

#### Scenario: Inspecting an agent returns its details
- **WHEN** the orchestrator calls `inspect_agent` for an agent in its project
- **THEN** that agent's identity and current state are returned

### Requirement: Operations are bounded to the orchestrator's project
Every toolkit operation SHALL be scoped to the orchestrator's `projectId`. An
operation targeting a pane outside that project, or a closed / nonexistent pane,
SHALL be rejected without performing the action.

#### Scenario: Cross-project target is rejected
- **WHEN** the orchestrator targets a pane that belongs to a different project
- **THEN** the operation is rejected and no action is performed

#### Scenario: Nonexistent or closed target is rejected
- **WHEN** the orchestrator targets a pane id that does not exist or is closed
- **THEN** the operation is rejected with an error and no action is performed

### Requirement: Toolkit excludes question-answering and governance
The runtime toolkit SHALL NOT expose `answer_question`, `request_user_input`,
or any escalation / autonomy / guardrail behavior.

#### Scenario: No answer_question in the runtime toolkit
- **WHEN** the runtime toolkit is exposed to an orchestrator
- **THEN** it provides spawn / message / read / list / inspect / archive / unarchive only
- **AND** it does not provide `answer_question`, `request_user_input`, or guardrail enforcement
