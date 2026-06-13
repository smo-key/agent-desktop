## MODIFIED Requirements

### Requirement: Surface Subagents
The system SHALL surface the subagents an app agent spawns under their parent
agent in the Inbox session list, read from the parent session directory under
`~/.claude/projects/<project>/<session>/`, and SHALL tolerate absent or partial
metadata. Two kinds of subagent SHALL be surfaced: WORKFLOW subagents, read from
the workflow run records (`workflows/<id>.json` `workflowProgress` rows); and
STANDALONE `Task`/`Agent` subagents, read from the bare per-subagent sidecars
(`subagents/agent-<id>.meta.json` plus the sibling `agent-<id>.jsonl`), where the
label comes from the meta's `description`, the start time and duration come from
the sidecar transcript's first/last entry timestamps, and the run/done status is
derived from whether the parent transcript has recorded a `tool_result` for the
subagent's `toolUseId`. Subagent rows SHALL be nested only under parent agents on
the In-flight and Needs-you lanes, and SHALL render always expanded (no collapse
control). Workflow subagents SHALL be grouped by workflow run, then by workflow
phase in phase order; standalone subagents, having no workflow or phase, SHALL
render as a flat list under the parent. Each subagent row SHALL show a status
indicator (running / done / error), the subagent label, and its duration alive —
the recorded `durationMs` when the subagent has finished, otherwise the elapsed
time since `startedAt`.

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

#### Scenario: Standalone Task subagents appear under their parent agent
- **WHEN** an app agent's session has standalone `Task` subagents recorded as bare
  sidecars (`subagents/agent-<id>.meta.json` + `agent-<id>.jsonl`) with no workflow
  run record
- **THEN** each is surfaced as a flat (ungrouped) row under that parent agent, with
  its label taken from the meta's `description` and its duration from the sidecar
  transcript's timestamps

#### Scenario: Standalone subagent status reflects the parent result
- **WHEN** the parent transcript has recorded a `tool_result` for a standalone
  subagent's `toolUseId`
- **THEN** that subagent's status is `done`
- **WHEN** the subagent's `tool_use` is still pending in the parent transcript with
  no matching `tool_result`
- **THEN** its status is `running`

#### Scenario: Subagents are hidden on inactive lanes
- **WHEN** a parent agent is on the Paused or Archived lane
- **THEN** no subagent rows are rendered under it, regardless of its recorded subagents

#### Scenario: Partial subagent metadata does not break the roster
- **WHEN** a subagent's workflow-progress record is missing fields or is malformed
- **THEN** that record is skipped or shown with only its available fields, and the
  rest of the roster and its other subagent rows are unaffected
