# task-detection Specification

## Purpose
TBD - created by archiving change add-agent-desktop. Update Purpose after archive.
## Requirements
### Requirement: Derive Current Task From Live Tasks Directory
The system SHALL derive a session's current task as the `activeForm` of the newest entry with `status: "in_progress"` found in `~/.claude/tasks/<session_id>/<N>.json`.

#### Scenario: Newest in_progress entry wins
- **WHEN** `~/.claude/tasks/<session_id>/` contains multiple task files and more than one has `status: "in_progress"`
- **THEN** the derived task is the `activeForm` of the entry from the highest-numbered (`<N>.json`) file
- **AND** entries with `status` of `pending` or `completed` are ignored when selecting the current task

#### Scenario: No in_progress entry yields null task
- **WHEN** `~/.claude/tasks/<session_id>/` exists but contains no entry with `status: "in_progress"`
- **THEN** the derived task is `null` and the session is shown with no task label rather than an error

### Requirement: Tolerate Task Schema Variations And Fallback Fields
The system SHALL parse task entries against the schema `{id, subject, description, activeForm, status, blocks, blockedBy}`, read `activeForm` as the primary task label, and fall back to `subject` then `content` when `activeForm` is absent for forward/backward compatibility.

#### Scenario: activeForm present
- **WHEN** a task entry has a non-empty `activeForm` field
- **THEN** the `activeForm` string is used as the task label

#### Scenario: activeForm missing, subject present
- **WHEN** the selected task entry has no `activeForm` field but has a `subject` field
- **THEN** the `subject` value is used as the task label

#### Scenario: Unknown extra fields do not break parsing
- **WHEN** a task entry contains additional fields not in the documented schema, or omits `blocks`/`blockedBy`
- **THEN** the entry still parses and a task label is derived from `activeForm`/`subject`/`content` without raising

### Requirement: Snapshot Is The Primary Task Source For App-Launched Sessions
The system SHALL read the per-pane task for app-launched sessions from the `task` field of the snapshot at `<app-support>/snapshots/<pane_id>.json` that the dashboard already watches, rather than re-reading the tasks directory.

#### Scenario: Task read from snapshot
- **WHEN** a session was launched by the app with `AGENT_DESKTOP_PANE=<uuid>` and its `snapshots/<pane_id>.json` contains `"task": "<activeForm>"`
- **THEN** that pane's card and badge show the snapshot `task` value without the app independently watching `~/.claude/tasks/` for that session

#### Scenario: Null task in snapshot
- **WHEN** the snapshot's `task` field is `null`
- **THEN** the pane card renders the model and context bar with no task label and no error

### Requirement: Direct-Watch Fallback For Foreign Sessions
The system SHALL provide a fallback that directly watches `~/.claude/tasks/` and `$TMPDIR/claude-ctx-<session_id>.json` to derive task and context for Claude sessions that were not launched by the app and therefore have no app-managed snapshot.

#### Scenario: Foreign session task surfaced
- **WHEN** a Claude session is running with no corresponding `snapshots/<pane_id>.json` file
- **THEN** the system derives its task by reading the newest `in_progress` entry under `~/.claude/tasks/<session_id>/` directly

#### Scenario: Context bridge fallback
- **WHEN** a foreign session has a `$TMPDIR/claude-ctx-<session_id>.json` file containing `{session_id, remaining_percentage, used_pct, timestamp}`
- **THEN** the system reads context percentage from that file for the session's card

#### Scenario: Missing todos directory is not required
- **WHEN** the system runs on CC 2.1.158 where `~/.claude/todos/` is absent
- **THEN** task derivation still succeeds using `~/.claude/tasks/` and never depends on `~/.claude/todos/`

### Requirement: Derive Live Versus Idle From Snapshot Heartbeat
The system SHALL classify a session as live or idle by treating the snapshot `ts` (unix timestamp) as a heartbeat, marking the session idle/ended when `ts` is stale.

#### Scenario: Fresh ts is live
- **WHEN** a pane's snapshot `ts` is recent relative to the configured staleness threshold
- **THEN** the session card shows the live (active) indicator dot

#### Scenario: Stale ts is idle
- **WHEN** a pane's snapshot `ts` has not advanced past the staleness threshold
- **THEN** the session card shows the idle/ended indicator dot

### Requirement: Surface Task Per Pane
The system SHALL surface the derived task both as a per-pane badge on the pane and on that session's dashboard card, alongside model, context bar, and the live/idle dot.

#### Scenario: Badge and card reflect current task
- **WHEN** a session's derived task is a non-null `activeForm`
- **THEN** the pane shows a task badge with that text and the dashboard card shows the same `activeForm` next to its model and context bar

#### Scenario: Task updates on snapshot change
- **WHEN** the watched snapshot for a pane changes its `task` value to a different `activeForm`
- **THEN** the per-pane badge and the dashboard card update to the new task text

