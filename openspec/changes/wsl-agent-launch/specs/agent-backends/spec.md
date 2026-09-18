## MODIFIED Requirements

### Requirement: Unsupported capabilities degrade by omission
The UI SHALL omit any feature gated on a backend capability flag the backend does not declare (no control, no empty placeholder, no error), and the pane SHALL otherwise behave as a first-class agent pane.

A backend's declared capabilities SHALL be a function of the LAUNCH CONTEXT as
well as the backend kind. A capability that the kind supports in general, but
which cannot function for a particular session because of where that session was
launched, SHALL be treated as undeclared for that session and degrade by the same
omission rule.

Where no launch context applies, a backend's capabilities SHALL be exactly those
it declares statically, so that existing behavior is unchanged.

#### Scenario: Copilot pane renders without Claude-only chrome
- **WHEN** a Copilot pane is focused
- **THEN** the context-percentage meter and task badge are absent (not rendered empty), while status, title, model label, and activity affordances render normally

#### Scenario: A capability unavailable in this launch context
- **WHEN** a pane's backend supports a capability in general, but the session was launched in a context where that capability cannot function
- **THEN** the surfaces gated on it are omitted for that pane, exactly as for a backend that never declared it
- **AND** the pane otherwise behaves as a first-class agent pane

#### Scenario: Capabilities without a launch context
- **WHEN** a backend's capabilities are consulted with no launch context
- **THEN** the statically declared capabilities apply unchanged
