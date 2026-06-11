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

