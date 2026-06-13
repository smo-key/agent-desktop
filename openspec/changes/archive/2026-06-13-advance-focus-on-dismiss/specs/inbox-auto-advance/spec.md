## ADDED Requirements

### Requirement: Explicit dismiss of the shown session advances focus

The inbox SHALL, when the user ARCHIVES, PAUSES, or DELETES the session that is
currently shown in the focus pane, immediately advance focus to the next
actionable session. The target SHALL be chosen in this priority order, in roster
(display) order within each lane:

1. the first **Needs-you** session, else
2. the first **In-flight** session, else
3. the empty "All clear" state (no session shown).

This advance SHALL be immediate (no grace delay) and SHALL apply regardless of
the auto-advance setting (it works even when auto-advance is OFF). The dismissed
session SHALL be excluded from the candidates. The advance SHALL fire ONLY when
the dismissed session is the one currently shown; archiving, pausing, or deleting
a session that is NOT the shown one SHALL NOT move focus.

#### Scenario: Dismiss advances to the first Needs-you session

- **WHEN** the user archives, pauses, or deletes the currently shown session while another session needs input
- **THEN** focus immediately moves to the first Needs-you session, and the dismissed session is not re-selected

#### Scenario: Dismiss falls back to the first In-flight session

- **WHEN** the user dismisses the currently shown session, no other session needs input, and at least one session is In-flight
- **THEN** focus immediately moves to the first In-flight session

#### Scenario: Dismiss with nothing actionable goes to All clear

- **WHEN** the user dismisses the currently shown session and no other session is Needs-you or In-flight
- **THEN** the focus pane shows the empty "All clear" state

#### Scenario: Advance ignores the auto-advance setting

- **WHEN** auto-advance is OFF and the user dismisses the currently shown session while another session is actionable
- **THEN** focus still advances immediately to that session

#### Scenario: Dismissing a background session does not move focus

- **WHEN** the user archives, pauses, or deletes a session that is NOT the one currently shown
- **THEN** focus stays on the currently shown session

#### Scenario: Deleting the shown session advances like archive and pause

- **WHEN** the user deletes the currently shown session while another session is actionable
- **THEN** focus advances to the next actionable session exactly as it would for archive or pause
