## ADDED Requirements

### Requirement: Coordinator lifecycle and toolkit come from add-agent-specialists
The coordinator SHALL reuse the lifecycle (at most one per project, started on
demand, persisted and reused, recorded on the project) and the agent-management
toolkit provided by the `agent-coordinator-workflows` and
`agent-orchestration-runtime` capabilities (introduced by the
`add-agent-specialists` change), and SHALL NOT re-specify them. This capability
adds only the GOVERNANCE behavior on top (the autonomy/guardrail system prompt,
escalation surfacing, and the no-coordinator fallback below).

#### Scenario: Lifecycle reused, not redefined
- **WHEN** a coordinator is started, reused, or persisted for a project
- **THEN** the behavior is that defined by `agent-coordinator-workflows` (single per project, on-demand, persistent/reused, recorded on the project)

### Requirement: Coordinator applies the governance system prompt
The coordinator SHALL be launched with a governance system prompt — in addition
to the orchestrator system prompt from `agent-coordinator-workflows` — that
defines its hybrid-autonomy policy and the hard guardrails.

#### Scenario: Governance prompt applied at launch
- **WHEN** a coordinator is started for a project
- **THEN** the launched `claude` pane has the hybrid-autonomy + hard-guardrail policy applied in addition to its orchestrator prompt

### Requirement: Coordinator-surfaced items are attributed in the inbox
Items the coordinator surfaces (defers) to the human SHALL appear in the Inbox
"Needs you" lane, attributed to the coordinator and identifying the originating
agent the item concerns. (The coordinator's distinct roster treatment is provided
by `agent-coordinator-workflows`.)

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
