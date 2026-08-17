## ADDED Requirements

### Requirement: Status inputs are per-backend, statuses are shared
Status derivation SHALL consume backend-specific input sources — Claude panes
from hook events, transcript tailing, and Claude TUI busy markers; Copilot
panes from session event-log turn/ask-user events and Copilot TUI busy
markers — and SHALL produce the same status vocabulary (Needs input / In
flight / Idle) with the same precedence rules for every agent backend.
Terminal busy-marker strings SHALL come from the pane's backend descriptor,
never from a hard-coded Claude string set.

#### Scenario: Copilot pane derives the same statuses
- **WHEN** a Copilot pane has a turn in flight, then asks a question, then goes quiet after the turn ends
- **THEN** it derives In flight, then Needs input, then Idle under the same precedence a Claude pane would

#### Scenario: Busy markers resolved per backend
- **WHEN** terminal-output busy scanning runs for a pane
- **THEN** the marker strings scanned for are those declared by that pane's backend descriptor

## REMOVED Requirements

### Requirement: A freshly launched coordinator reads Waiting, not Working
**Reason**: The coordinator feature is removed from the product; no pane type
with coordinator-specific status semantics remains.
**Migration**: None required — non-coordinator agent panes keep their existing
status derivation, which this requirement did not alter.
