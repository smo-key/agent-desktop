## MODIFIED Requirements

### Requirement: Surface Subagents
The system SHALL surface workflow-spawned subagents that an app agent spawns
under their parent agent in the Inbox session list, read from the parent
session's workflow run records (`workflows/<id>.json` `workflowProgress` rows)
under `~/.claude/projects/<project>/<session>/`, and SHALL tolerate absent or
partial metadata. Subagent rows SHALL be nested only under parent agents on the
In-flight and Needs-you lanes; they SHALL be grouped by workflow run, then by
workflow phase in phase order, and SHALL render always expanded (no collapse
control). Each subagent row SHALL show a status indicator (running / done /
error), the subagent label, and its duration alive — the recorded `durationMs`
when the subagent has finished, otherwise the elapsed time since `startedAt`.
Standalone Task-tool subagents that have no workflow, phase, status, or duration
data are out of scope and are not surfaced.

#### Scenario: Subagents appear nested under their parent agent on active lanes
- **WHEN** an app agent on the In-flight or Needs-you lane has a session with
  workflow subagents recorded under its project session directory
  (`workflows/<id>.json` with `workflowProgress` agent rows)
- **THEN** each subagent is listed as an indented row under that parent agent,
  grouped by its workflow run and then by its workflow phase in phase order,
  always expanded
- **AND** each row shows the subagent's status indicator, its label, and its
  duration alive

#### Scenario: Duration alive reflects finished versus running subagents
- **WHEN** a surfaced subagent has finished and has a recorded `durationMs`
- **THEN** its row shows that duration
- **WHEN** a surfaced subagent is still running with a `startedAt` but no final
  `durationMs`
- **THEN** its row shows the elapsed time since `startedAt`, advancing as time passes

#### Scenario: Subagents are hidden on inactive lanes
- **WHEN** a parent agent is on the Paused or Archived lane
- **THEN** no subagent rows are rendered under it, regardless of its recorded subagents

#### Scenario: Partial subagent metadata does not break the roster
- **WHEN** a subagent's workflow-progress record is missing fields or is malformed
- **THEN** that record is skipped or shown with only its available fields, and the
  rest of the roster and its other subagent rows are unaffected
