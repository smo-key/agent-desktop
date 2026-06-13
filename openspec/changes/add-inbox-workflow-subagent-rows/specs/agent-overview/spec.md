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
subagent's `toolUseId`. Subagent rows SHALL be nested under their parent agent on
EVERY lane (not only the active ones), and SHALL render always expanded (no
collapse control). Only LIVE subagents SHALL be shown: a subagent whose status is
a terminal/exited state (`done`/`completed`/`success` or `error`/`failed`) SHALL
be omitted, so a subagent drops off the list as soon as it exits and only
in-flight ones remain. Workflow subagents SHALL be grouped by workflow run, then
by workflow phase in phase order; standalone subagents, having no workflow or
phase, SHALL render as a flat list under the parent. Each subagent row SHALL show
a live (in-flight) status indicator, the subagent label, and its duration alive —
the recorded `durationMs` when present, otherwise the elapsed time since
`startedAt`. Whether subagents are surfaced at all SHALL be governed by a
Sessions-panel setting that DEFAULTS TO SHOWN; when the user turns it off, no
subagent rows are rendered under any agent.

#### Scenario: Subagents appear nested under their parent agent
- **WHEN** an app agent on any lane has a session with workflow subagents recorded
  under its project session directory (`workflows/<id>.json` with
  `workflowProgress` agent rows)
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

#### Scenario: Exited subagents drop off the list
- **WHEN** a surfaced subagent's status is a terminal/exited state
  (`done`/`completed`/`success` or `error`/`failed`)
- **THEN** it is omitted from the nested rows, leaving only the still-running
  subagents
- **AND** a parent agent whose subagents have all exited shows no subagent rows

#### Scenario: Subagents can be hidden by a setting that defaults to shown
- **WHEN** the Sessions-panel show-subagents setting is on, which is its default on
  a fresh install
- **THEN** subagents are nested under their parent agents
- **WHEN** the user turns that setting off
- **THEN** no subagent rows are rendered under any agent

#### Scenario: Partial subagent metadata does not break the roster
- **WHEN** a subagent's workflow-progress record is missing fields or is malformed
- **THEN** that record is skipped or shown with only its available fields, and the
  rest of the roster and its other subagent rows are unaffected
