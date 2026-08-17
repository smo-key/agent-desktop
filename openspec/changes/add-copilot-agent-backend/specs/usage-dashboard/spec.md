## ADDED Requirements

### Requirement: Snapshots from non-statusline backends render without Claude-only fields
The usage pipeline SHALL accept snapshots produced by backend adapters other
than the Claude statusline wrapper. A snapshot lacking Claude-only fields
(context percentage, rate limits, effort) SHALL render its pane's card and
footer presence without those elements rather than showing empty meters or
misleading zeros, and agent-pane detection in usage surfaces SHALL consult
the backend registry rather than comparing against the literal `claude`.

#### Scenario: Copilot snapshot joins the dashboard
- **WHEN** the Copilot events adapter writes a snapshot for pane `P` with a model id and token totals but no context or rate-limit fields
- **THEN** `P` appears in usage surfaces with its model and activity, with the context bar and rate-limit areas absent

#### Scenario: Non-agent filtering uses the registry
- **WHEN** the footer decides which panes are agent sessions
- **THEN** a `copilot` pane counts as an agent session and a plain shell pane does not

## MODIFIED Requirements

### Requirement: Footer shows the focused session's model and effort

The footer SHALL display the focused session's MODEL and reasoning EFFORT as two
NON-INTERACTIVE pills on its right side, derived from that session's latest snapshot.
The model pill SHALL show a human-readable, VERSIONED model label (e.g. "Opus 4.6")
derived from the snapshot model id by the session's BACKEND-DECLARED label
formatter (a Copilot session's model ids — e.g. `gpt-5`, `claude-sonnet-5` — are
formatted by the Copilot backend's formatter), falling back to the snapshot's model
display name, then to the raw id. The effort pill SHALL show the effort level (e.g.
"High"); WHEN the snapshot reports no effort (the model does not support it, or the
backend does not report effort), the effort pill SHALL be OMITTED. Neither pill
SHALL be clickable.

#### Scenario: Model and effort pills shown for the focused session
- **WHEN** the focused session's latest snapshot has a model and an effort level
- **THEN** the footer shows a non-clickable model pill (versioned label) and a non-clickable effort pill

#### Scenario: Effort pill omitted when unavailable
- **WHEN** the focused session's latest snapshot reports no effort level
- **THEN** the footer shows the model pill and omits the effort pill

#### Scenario: Pills are display-only
- **WHEN** the user clicks a footer model or effort pill
- **THEN** nothing happens (the pills are not interactive)

#### Scenario: Copilot model label formatted by its backend
- **WHEN** the focused pane is a Copilot session whose snapshot model id is `gpt-5`
- **THEN** the model pill shows the Copilot backend's formatted label for `gpt-5` and no effort pill is shown unless the snapshot reports effort
