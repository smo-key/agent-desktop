## ADDED Requirements

### Requirement: One coordinator per project, started on demand
The system SHALL allow at most one coordinator agent per project. A coordinator
SHALL NOT start automatically; it MUST be started by an explicit user action for
that project.

#### Scenario: Starting a coordinator for a project without one
- **WHEN** the user invokes "Start coordinator" for a project that has no running coordinator
- **THEN** the system launches a coordinator agent bound to that project
- **AND** the coordinator becomes the project's single coordinator

#### Scenario: Starting when one already runs reuses it
- **WHEN** the user invokes "Start coordinator" for a project whose coordinator is already running
- **THEN** the system does not launch a second coordinator
- **AND** it focuses / reuses the existing coordinator

### Requirement: Coordinator is a claude pane with the toolkit attached
The coordinator SHALL be a `claude` session running in a PTY pane bound to the
project. It MUST be launched with the coordinator MCP toolkit server attached and
with a system prompt that defines its coordinator role, the hybrid-autonomy
policy, and the hard guardrails.

#### Scenario: Coordinator launch wiring
- **WHEN** a coordinator is started for a project
- **THEN** the launched pane runs `claude` with `cwd` inside the project
- **AND** the MCP toolkit server is configured for that session
- **AND** the coordinator's role/guardrail system prompt is applied

### Requirement: Coordinator persists and is reused for the session
Once started, a coordinator SHALL persist for the app session and be reused. The
project SHALL record its coordinator session so it is not duplicated and can be
identified after focus changes or restart.

#### Scenario: Coordinator persists across navigation
- **WHEN** the user navigates away from and back to a project with a running coordinator
- **THEN** the same coordinator session is still running and is reused

### Requirement: Coordinator is distinctly surfaced to the human
The human SHALL be able to interact with the coordinator directly in its own
pane. The coordinator MUST be visually distinguished in the agents roster from
normal agents (e.g. a badge or dedicated lane). Items the coordinator surfaces to
the human SHALL appear in the Inbox "Needs you" lane attributed to the
coordinator and to the agent the item concerns.

#### Scenario: Coordinator is distinguished in the roster
- **WHEN** a project has a running coordinator
- **THEN** the coordinator appears in the agents roster with distinct treatment identifying it as the project's coordinator

#### Scenario: Surfaced item is attributed in the inbox
- **WHEN** the coordinator surfaces an item to the human
- **THEN** the item appears in the "Needs you" lane
- **AND** it is attributed to the coordinator and identifies the originating agent

### Requirement: Projects without a coordinator are unaffected
A project with no running coordinator SHALL behave exactly as it does today, with
agent questions surfacing directly to the human.

#### Scenario: No coordinator, current behavior preserved
- **WHEN** an agent in a project with no running coordinator raises a question
- **THEN** the question surfaces directly to the human in "Needs you" as it does without this feature
