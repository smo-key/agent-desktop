## MODIFIED Requirements

### Requirement: Surface Subagents
The system SHALL surface subagents that an app agent spawns (Task-tool agents and workflow agents) under their parent agent, read from the parent session's workflow run records and per-subagent metadata under `~/.claude/projects/<project>/<session>/`, and SHALL tolerate absent or partial metadata. The system SHALL exclude subagents that started before the current app launch: any surfaced subagent whose start time is known and earlier than the app's launch time SHALL be omitted, while a subagent whose start time is unknown SHALL be retained.

#### Scenario: Subagents appear under their parent agent
- **WHEN** an app agent's session has spawned subagents recorded under its project session directory (`workflows/<id>.json` and `subagents/**/agent-*.meta.json`)
- **THEN** each subagent is listed under that parent agent with its label and status

#### Scenario: Partial subagent metadata does not break the roster
- **WHEN** a subagent metadata record is missing fields or is malformed
- **THEN** that record is skipped or shown with only its available fields, and the rest of the roster is unaffected

#### Scenario: A running subagent from before this launch is not restored
- **WHEN** a resumed session's records include a subagent still marked running whose start time is earlier than the current app launch time
- **THEN** that subagent is omitted from the surfaced list, so it does not reappear and tick as if still active

#### Scenario: A completed subagent from before this launch is not restored
- **WHEN** a resumed session's records include a subagent that completed and whose start time is earlier than the current app launch time
- **THEN** that subagent is omitted from the surfaced list

#### Scenario: A subagent started in the current run is surfaced
- **WHEN** a session spawns a subagent whose start time is at or after the current app launch time
- **THEN** that subagent is surfaced under its parent agent

#### Scenario: A subagent with an unknown start time is retained
- **WHEN** a surfaced subagent has no known start time
- **THEN** that subagent is retained rather than excluded, so a newly spawned subagent that briefly lacks a timestamp is never hidden
