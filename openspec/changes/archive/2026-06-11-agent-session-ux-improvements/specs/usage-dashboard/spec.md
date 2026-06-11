## MODIFIED Requirements

### Requirement: Atomic Per-Pane Snapshot Write

The wrapper SHALL write each snapshot to `<AGENT_DESKTOP_SNAPSHOT_DIR>/<AGENT_DESKTOP_PANE>.json`, keyed on the pane id (not `session_id`), using a temp-file-plus-`rename` so the watcher never observes a partial file, with the JSON object `{pane_id, session_id, model, model_id, effort, task, context_pct, rate_limits, cost, git, ts}`.

#### Scenario: File keyed on pane id

- **WHEN** the wrapper writes a snapshot for pane `<uuid>`
- **THEN** the target filename is `<uuid>.json`, so a session that resumes or forks (changing `session_id`) does not orphan or duplicate the pane's card

#### Scenario: Atomic tmp+rename

- **WHEN** the wrapper writes a snapshot
- **THEN** it first writes to a temp file in the same dir and then `rename`s it into place, so any reader either sees the previous complete file or the new complete file, never a truncated one

#### Scenario: Snapshot field shape

- **WHEN** a snapshot is written
- **THEN** it contains `pane_id`, `session_id` (or null), `model` (the model display name, or null), `model_id` (the model id, or null), `effort` (the reasoning effort level, or null when the model reports none), `task` (or null), `context_pct` (0-100 or null), `rate_limits` (object or null), `cost` (usd or null), `git`, and `ts` (unix timestamp)

## ADDED Requirements

### Requirement: Footer shows the focused session's model and effort

The footer SHALL display the focused session's MODEL and reasoning EFFORT as two
NON-INTERACTIVE pills on its right side, derived from that session's latest snapshot.
The model pill SHALL show a human-readable, VERSIONED model label (e.g. "Opus 4.6")
derived from the snapshot model id, falling back to the snapshot's model display name.
The effort pill SHALL show the effort level (e.g. "High"); WHEN the snapshot reports no
effort (the model does not support it), the effort pill SHALL be OMITTED. Neither pill
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

### Requirement: Footer usage tooltips show when each window resets

Each footer rate-limit bar (the 5-hour and 7-day windows) SHALL expose a tooltip that
states the percent used AND WHEN that window resets, given as an ABSOLUTE local time:
just the time-of-day (e.g. "resets at 3:45 PM") when the reset falls later on the same
calendar day, or the date and time (e.g. "resets Jun 12 at 3:45 PM") when it falls on a
different day. WHEN the reset time is unknown, the tooltip SHALL omit the reset clause
and show only the percent used. The reset time SHALL be rendered in the user's local
timezone and locale.

#### Scenario: Tooltip shows a same-day reset as a time
- **WHEN** a rate-limit window resets later on the same calendar day and its tooltip is shown
- **THEN** the tooltip includes the percent used and the absolute reset time (e.g. "resets at 3:45 PM")

#### Scenario: Tooltip shows a different-day reset as date and time
- **WHEN** a rate-limit window resets on a different calendar day and its tooltip is shown
- **THEN** the tooltip includes the reset date and time (e.g. "resets Jun 12 at 3:45 PM")

#### Scenario: Tooltip omits an unknown reset
- **WHEN** a rate-limit window's reset time is unknown
- **THEN** its tooltip shows only the percent used, with no reset clause
