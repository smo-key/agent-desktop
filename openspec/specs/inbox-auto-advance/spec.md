# inbox-auto-advance Specification

## Purpose
TBD - created by archiving change agent-session-ux-improvements. Update Purpose after archive.
## Requirements
### Requirement: Opt-in auto-advance to the next Needs-Input agent

The inbox SHALL provide a user setting that controls whether focus automatically
advances to the next agent needing input after the currently focused agent leaves
the attention state. The setting SHALL default to OFF (no auto-advance). When OFF,
the inbox SHALL NOT move focus on its own. When ON, the existing advance behavior
(advance to the next needs-input agent after the focused one is handled, following
the current grace delay) applies. Manual navigation — the next/previous keyboard
shortcuts and the next/previous buttons — SHALL be unaffected by the setting.

#### Scenario: Default is off
- **WHEN** the auto-advance setting has never been configured (fresh install or an empty/corrupt settings blob)
- **THEN** auto-advance is OFF

#### Scenario: Off — focus does not auto-advance
- **WHEN** auto-advance is OFF and the focused agent leaves the attention state (it is handled / goes back to working)
- **THEN** focus stays put; the inbox does not move to another agent on its own

#### Scenario: On — focus advances to the next needs-input agent
- **WHEN** auto-advance is ON and the focused agent leaves the attention state while another agent needs input
- **THEN** after the existing grace delay, focus advances to the next needs-input agent

#### Scenario: Manual navigation is unaffected
- **WHEN** the user presses the next/previous agent shortcut or button
- **THEN** focus moves to the adjacent agent in the queue regardless of the auto-advance setting

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

