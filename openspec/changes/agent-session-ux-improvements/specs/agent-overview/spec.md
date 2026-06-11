## MODIFIED Requirements

### Requirement: Agent Usage Tracking
The system SHALL track usage per agent (cost, context percentage, and token counts where available) and SHALL show an aggregate usage total across all agents and their subagents. A per-agent CARD SHALL surface the agent's MODEL and context — NOT its dollar cost; the dollar cost SHALL be surfaced in the aggregate total (and the footer) rather than on each card.

#### Scenario: Per-agent card reflects the snapshot model and context
- **WHEN** an agent has a latest snapshot
- **THEN** its card reflects that snapshot's model and context percentage, and does not show the per-agent dollar cost

#### Scenario: Aggregate usage sums agents and subagents
- **WHEN** the overview computes the usage total
- **THEN** it sums each agent's cost together with each available subagent's recorded usage, ignoring records whose usage is unavailable
