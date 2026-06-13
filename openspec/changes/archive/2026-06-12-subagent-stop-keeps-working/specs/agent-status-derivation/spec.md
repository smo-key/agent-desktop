## ADDED Requirements

### Requirement: A working parent stays In flight while a Task subagent finishes

A LIVE agent SHALL continue to read **In flight** (working) when an in-process Task
subagent it spawned finishes (a `SubagentStop` event), because the parent's `Task`
tool has not returned and the parent is still mid-turn. A `SubagentStop` event SHALL
NOT, on its own, move the agent to **Needs input** (`waiting`) and SHALL NOT clear the
agent's in-flight tool. Only the agent's OWN turn end (a `Stop` event) returns it to
the awaiting-you state. This holds when several subagents run in parallel: each
subagent's `SubagentStop` leaves the parent In flight while its siblings (and the
parent `Task`) are still running.

A `SubagentStop` SHALL still count as evidence the session has begun a turn (a subagent
can only run after a prompt), so the freshly-launched-coordinator "never prompted"
heuristic does not regress.

#### Scenario: Subagent finishes while the parent Task is in flight
- **WHEN** an agent has a `Task` tool in flight (a `PreToolUse[Task]` with no matching `PostToolUse`) and a `SubagentStop` event arrives for the finished subagent
- **THEN** the agent is shown In flight (working), not Needs input

#### Scenario: One of several parallel subagents finishes
- **WHEN** an agent ran multiple subagents in parallel and one of them emits `SubagentStop` while the others are still running
- **THEN** the agent remains In flight (working), not Needs input

#### Scenario: The parent's own turn end still reads Needs input
- **WHEN** a subagent has finished (`SubagentStop`) and the agent later ends its own turn (a `Stop` event with no tool in flight)
- **THEN** the agent is shown Needs input (waiting), awaiting you

#### Scenario: A subagent run proves the session was prompted
- **WHEN** a session's observed events include a `SubagentStop` (a subagent ran) but the original `UserPromptSubmit` is no longer present
- **THEN** the session is still treated as having begun a turn (everPrompted), so a coordinator is not wrongly reverted to the never-prompted Waiting state
