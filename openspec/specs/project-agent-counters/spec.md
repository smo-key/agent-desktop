# project-agent-counters Specification

## Purpose
TBD - created by archiving change agent-session-ux-improvements. Update Purpose after archive.
## Requirements
### Requirement: Archived agents are excluded from project counters

The project agent counters SHALL count only NON-archived agents — the per-project
count, the unassigned count, and the all-agents count each exclude archived agents.
Archived (closed) and previewed agents SHALL NOT be included in any of these counters.

#### Scenario: Per-project count excludes archived agents
- **WHEN** a project has N live agents and M archived agents
- **THEN** its counter shows N (the archived agents are not counted)

#### Scenario: Unassigned count excludes archived agents
- **WHEN** some agents with no project are archived
- **THEN** the unassigned counter counts only the non-archived ones

#### Scenario: All-agents count excludes archived agents
- **WHEN** the all-agents counter is shown
- **THEN** it counts only non-archived agents

#### Scenario: Archiving updates the counter
- **WHEN** a live agent is archived
- **THEN** its project's counter decrements by one; restoring it increments the counter again

