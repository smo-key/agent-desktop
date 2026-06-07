## ADDED Requirements

### Requirement: Explicit escalation via ask_coordinator
Every non-coordinator agent in a project SHALL be provided an `ask_coordinator`
tool. When called, the system SHALL route the agent's question to that project's
running coordinator, tagged with the originating agent so the coordinator can act
on it.

#### Scenario: Agent explicitly asks the coordinator
- **WHEN** a project agent calls `ask_coordinator` with a question and the project's coordinator is running
- **THEN** the question is delivered to the coordinator tagged with the originating agent's identity
- **AND** the coordinator can act on it via the toolkit

#### Scenario: Explicit escalation with no coordinator falls back
- **WHEN** a project agent calls `ask_coordinator` and no coordinator is running for the project
- **THEN** the tool signals the agent to fall back to a normal human question

### Requirement: Implicit escalation intercepts pending questions
The system SHALL route a non-coordinator agent's pending input request to the
coordinator first, instead of immediately surfacing it to the human, whenever
that agent's project has a running coordinator. This applies to a pending
`AskUserQuestion` and to other needs-human-input signals beyond the agent's
initial prompt.

#### Scenario: Pending question routed to coordinator
- **WHEN** a non-coordinator agent raises a pending question and its project has a running coordinator
- **THEN** the item is routed to the coordinator before reaching the human "Needs you" lane

#### Scenario: Coordinator's own questions are never intercepted
- **WHEN** the coordinator pane itself raises a pending question
- **THEN** the item is not intercepted and surfaces directly to the human

#### Scenario: An already-routed item is not re-routed
- **WHEN** an item has already been routed to the coordinator
- **THEN** the system does not route the same item to the coordinator again

### Requirement: Human is the fallback
The human SHALL receive an escalated item when no coordinator is running for the
project, when the coordinator defers it, or when routing to the coordinator does
not resolve within a timeout.

#### Scenario: Coordinator defers to the human
- **WHEN** the coordinator chooses to defer an item to the human
- **THEN** the item surfaces in the "Needs you" lane with the coordinator's note attached

#### Scenario: Timeout fallback to the human
- **WHEN** a routed item is not resolved by the coordinator within the timeout
- **THEN** the item surfaces to the human

### Requirement: Hybrid autonomy with hard guardrails
The coordinator SHALL answer routine, low-risk escalations autonomously and
surface the rest to the human. The system SHALL enforce a fixed guardrail set —
covering destructive/irreversible actions, deletions, money, and production — such
that items matching it cannot be answered autonomously and are forced to the
human.

#### Scenario: Routine item answered autonomously
- **WHEN** the coordinator determines an escalated item is routine and low-risk
- **THEN** the coordinator answers it via the toolkit without involving the human

#### Scenario: Guardrailed item cannot be auto-answered
- **WHEN** an escalated item matches the hard guardrail set
- **THEN** the system refuses to let the coordinator answer it autonomously
- **AND** the item is forced to the human
