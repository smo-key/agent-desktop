## ADDED Requirements

### Requirement: Coordinator consumes the shared orchestration runtime toolkit
The coordinator SHALL use the `agent-orchestration-runtime` toolkit for all
non-governance agent management — the MCP transport (control channel + executor)
and the operations `spawn_agent`, `message_agent`, `read_agent`, `list_agents`,
`inspect_agent`, `archive_agent`, and `unarchive_agent`, including their
project-scoping and serialization guarantees. This capability does NOT
re-specify those; it adds only the governance behavior below
(`answer_question` + guardrails) on top of that runtime.

#### Scenario: Coordinator manages agents via the runtime toolkit
- **WHEN** the coordinator spawns, messages, reads, lists, inspects, or archives an agent in its project
- **THEN** the behavior is that defined by `agent-orchestration-runtime` (carried over the control channel to the frontend executor, project-scoped)

### Requirement: Answer an agent's pending question
The toolkit SHALL additionally expose `answer_question` to the coordinator
session (not part of the shared runtime), letting it resolve a waiting agent's
pending question by selecting an option or supplying text, unblocking that
agent — subject to the escalation guardrails.

#### Scenario: Coordinator answers a pending question
- **WHEN** the coordinator calls `answer_question` for an agent with a non-guardrailed pending question
- **THEN** the agent's question is resolved with the coordinator's answer and the agent is unblocked

#### Scenario: Answer refused for a guardrailed item
- **WHEN** the coordinator calls `answer_question` for an item matching the hard guardrail set
- **THEN** the call is refused and the item is forced to the human
