## MODIFIED Requirements

### Requirement: List and inspect project agents
The toolkit SHALL let the orchestrator enumerate the project's agent panes
(`list_agents`) and inspect a single agent (`inspect_agent`). `list_agents` SHALL
return every `claude` agent pane in the project — both orchestrator-spawned agents
and the user's manually-started sessions.

The identity returned for an agent SHALL use that agent's generated session title
when one is available (the same short focus label shown on the agent's card),
falling back to the workspace display name — and then the cwd leaf / pane id — when
no title has been generated yet. The orchestrator therefore refers to an agent by a
meaningful name (e.g. "Fix login dialog") rather than its raw "Session N" ordinal.

#### Scenario: Listing returns all project agents
- **WHEN** the orchestrator calls `list_agents`
- **THEN** every `claude` agent pane in the orchestrator's project is returned, including the user's pre-existing sessions

#### Scenario: Inspecting an agent returns its details
- **WHEN** the orchestrator calls `inspect_agent` for an agent in its project
- **THEN** that agent's identity and current state are returned

#### Scenario: Coordinator panes are excluded from listing
- **WHEN** the orchestrator calls `list_agents` in a project that has a coordinator pane
- **THEN** the coordinator pane is not included in the result

#### Scenario: Agent identified by its generated title
- **WHEN** the orchestrator lists or inspects an agent whose generated session title is "Fix login dialog" while its workspace name is still "Session 1"
- **THEN** that agent's returned name is "Fix login dialog", not "Session 1"

#### Scenario: Falls back to the workspace name when untitled
- **WHEN** the orchestrator lists or inspects an agent that has no generated session title yet
- **THEN** that agent's returned name is its workspace display name (or cwd leaf / pane id)
</content>
