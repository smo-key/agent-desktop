## MODIFIED Requirements

### Requirement: Direct-Watch Fallback For Foreign Sessions
The system SHALL provide a CLAUDE-BACKEND-SPECIFIC fallback that directly watches `~/.claude/tasks/` and `$TMPDIR/claude-ctx-<session_id>.json` to derive task and context for Claude sessions that were not launched by the app and therefore have no app-managed snapshot. This fallback applies only to the Claude backend; backends without a tasks directory (e.g. Copilot) surface no task badge, and their panes render without a task area rather than with an empty one.

#### Scenario: Foreign session task surfaced
- **WHEN** a Claude session is running with no corresponding `snapshots/<pane_id>.json` file
- **THEN** the system derives its task by reading the newest `in_progress` entry under `~/.claude/tasks/<session_id>/` directly

#### Scenario: Context bridge fallback
- **WHEN** a foreign session has a `$TMPDIR/claude-ctx-<session_id>.json` file containing `{session_id, remaining_percentage, used_pct, timestamp}`
- **THEN** the system reads context percentage from that file for the session's card

#### Scenario: Missing todos directory is not required
- **WHEN** the system runs on CC 2.1.158 where `~/.claude/todos/` is absent
- **THEN** task derivation still succeeds using `~/.claude/tasks/` and never depends on `~/.claude/todos/`

#### Scenario: Copilot panes have no task badge
- **WHEN** a Copilot pane is running
- **THEN** no task derivation is attempted for it and no task badge or empty task placeholder is rendered
