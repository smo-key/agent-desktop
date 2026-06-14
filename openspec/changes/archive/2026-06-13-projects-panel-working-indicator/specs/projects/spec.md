# projects delta

## MODIFIED Requirements

### Requirement: Filter The Fleet By Project
The system SHALL provide a project panel (shared by both overviews) that filters the agent roster by project, showing each project's live agent count and a per-project status indicator, plus an "All agents" option and a bucket for unassigned agents. The status indicator SHALL reflect the project's live agents: a needs-you (attention) indicator when ANY of its agents is waiting/errored, OR — when none need the user but ANY agent is actively working — a distinct working (in-flight) indicator that visually differs from the attention one (e.g. a blue, flashing dot vs. the solid attention dot). The needs-you indicator SHALL take precedence over the working one. When no live agent needs the user AND none is working, the project SHALL show NO status indicator. Paused, archived (closed), and previewed agents SHALL contribute to neither indicator.

#### Scenario: Filter agents by project
- **WHEN** a project (or "All agents", or the unassigned bucket) is selected in the panel
- **THEN** the roster is filtered to the agents bound to that selection
- **AND** the panel shows each project's agent count and flags a project whose agents are waiting/errored

#### Scenario: Project flags a working agent
- **WHEN** a project has at least one live agent that is actively working (status `working`) and none that are waiting/errored
- **THEN** the panel shows that project's working (blue, flashing) indicator and no attention indicator
- **AND** a project whose only working agent is paused, archived, or previewed shows no indicator

#### Scenario: Attention outranks working
- **WHEN** a project has both an agent that needs the user (waiting/errored) and another that is actively working
- **THEN** the panel shows the needs-you (attention) indicator, not the working one
