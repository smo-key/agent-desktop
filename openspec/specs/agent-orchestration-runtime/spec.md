# agent-orchestration-runtime Specification

## Purpose
TBD - created by archiving change add-agent-specialists. Update Purpose after archive.
## Requirements
### Requirement: Toolkit exposed to an orchestrator over MCP
The system SHALL expose the project-scoped agent-management toolkit to an
orchestrator `claude` session as MCP tools via a bundled stdio MCP adapter. Each
tool call SHALL be carried over the app control channel to the frontend executor
that owns the pane registry, and SHALL return a result (or a structured error) to
the orchestrator.

#### Scenario: Orchestrator invokes a toolkit tool
- **WHEN** the orchestrator invokes a toolkit tool
- **THEN** the call is carried over the control channel to the frontend executor, performed, and a result is returned to the orchestrator

#### Scenario: Tool call that times out returns an error
- **WHEN** a toolkit tool call is not answered by the executor within its per-request timeout
- **THEN** the system returns a structured error for that call rather than hanging
- **AND** the orchestrator observes it as a failed tool call

### Requirement: Control channel carries identified request/response
The control channel SHALL carry each tool invocation as a JSON request with a
unique request id and SHALL route the matching reply back to that request. The
frontend SHALL return results via a dedicated reply command keyed by the request
id.

#### Scenario: Reply is routed to its originating request
- **WHEN** the frontend returns a result for a given request id
- **THEN** the system delivers that result to the tool call that carried the same request id

#### Scenario: Concurrent requests do not cross results
- **WHEN** multiple tool calls are in flight with distinct request ids
- **THEN** each call receives only its own matching reply

### Requirement: Spawn new agents
The toolkit SHALL let the orchestrator spawn a new `claude` agent pane in its
project with a given initial prompt and an optional working directory within the
project. The new agent's identity SHALL be returned to the orchestrator.

#### Scenario: Orchestrator spawns an agent
- **WHEN** the orchestrator calls `spawn_agent` with a prompt
- **THEN** a new agent pane is launched in the orchestrator's project with that prompt as its initial input
- **AND** the new agent's identity is returned to the orchestrator

### Requirement: Message and read existing agents
The toolkit SHALL let the orchestrator send input to a running agent
(`message_agent`) and read that agent's recent output / state (`read_agent`).
These operations SHALL apply to every `claude` agent pane in the project,
including sessions the user started manually, not only orchestrator-spawned ones.
When the target agent is blocked on a pending `AskUserQuestion`, `message_agent`
SHALL be refused with an error rather than delivering the text — free-form input
cannot answer a structured multiple-choice question and would be lost or misread,
so the orchestrator must wait for the question to clear (or have the user answer it).

#### Scenario: Orchestrator messages an agent
- **WHEN** the orchestrator calls `message_agent` for a running agent in its project with text
- **THEN** the text is delivered as input to that agent's session

#### Scenario: Messaging an agent awaiting a question is refused
- **WHEN** the orchestrator calls `message_agent` for an agent that is currently blocked on a pending `AskUserQuestion`
- **THEN** the operation is rejected with an error indicating the agent is awaiting a question, and no text is delivered to the pane

#### Scenario: Orchestrator reads an agent
- **WHEN** the orchestrator calls `read_agent` for an agent in its project
- **THEN** the agent's recent output / activity is returned to the orchestrator

#### Scenario: Orchestrator interacts with a user-started session
- **WHEN** the orchestrator calls `message_agent` or `read_agent` for a `claude` agent pane the user started by hand in the orchestrator's project
- **THEN** the operation applies to that pane the same as for an orchestrator-spawned agent

### Requirement: List and inspect project agents
The toolkit SHALL let the orchestrator enumerate the project's agent panes
(`list_agents`) and inspect a single agent (`inspect_agent`). `list_agents` SHALL
return every `claude` agent pane in the project — both orchestrator-spawned agents
and the user's manually-started sessions.

#### Scenario: Listing returns all project agents
- **WHEN** the orchestrator calls `list_agents`
- **THEN** every `claude` agent pane in the orchestrator's project is returned, including the user's pre-existing sessions

#### Scenario: Inspecting an agent returns its details
- **WHEN** the orchestrator calls `inspect_agent` for an agent in its project
- **THEN** that agent's identity and current state are returned

#### Scenario: Coordinator panes are excluded from listing
- **WHEN** the orchestrator calls `list_agents` in a project that has a coordinator pane
- **THEN** the coordinator pane is not included in the result

### Requirement: Archive and unarchive project agents
The toolkit SHALL let the orchestrator archive (`archive_agent`) and unarchive
(`unarchive_agent`) an agent pane within its project, using the app's existing
archive state.

#### Scenario: Orchestrator archives an agent
- **WHEN** the orchestrator calls `archive_agent` for an agent in its project
- **THEN** that agent pane is moved to the archived state

#### Scenario: Orchestrator unarchives an agent
- **WHEN** the orchestrator calls `unarchive_agent` for an archived agent in its project
- **THEN** that agent pane is restored from the archived state

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

#### Scenario: Targeting a coordinator pane is rejected
- **WHEN** the orchestrator targets a pane whose role is coordinator (including its own pane)
- **THEN** the operation is rejected with an error and no action is performed

### Requirement: Injections into one agent are serialized
The system SHALL serialize input injections directed at a single agent so that
concurrent or rapid `message_agent` / `spawn_agent` deliveries to the same target
do not interleave. Delivery of an injection to a busy target SHALL be deferred
until the target can accept input.

#### Scenario: Two injections to the same agent do not interleave
- **WHEN** two `message_agent` injections target the same agent at nearly the same time
- **THEN** they are delivered one after another, not interleaved

#### Scenario: Injection to a busy agent is deferred
- **WHEN** an injection targets an agent that is mid-turn / not ready for input
- **THEN** the injection is held and delivered once the agent can accept input

### Requirement: Toolkit excludes question-answering and governance
The runtime toolkit SHALL NOT expose `answer_question` or any escalation /
autonomy / guardrail behavior. Those concerns are owned by the separate
coordinator-governance capability.

#### Scenario: No answer_question in the runtime toolkit
- **WHEN** the runtime toolkit is exposed to an orchestrator
- **THEN** it provides spawn / message / read / list / inspect / archive / unarchive only
- **AND** it does not provide `answer_question` or guardrail enforcement

