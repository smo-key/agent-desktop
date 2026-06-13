# agent-roster-display (delta)

## ADDED Requirements

### Requirement: Compact mode hides the roster row's meta line

The sessions panel SHALL offer an opt-in "Compact mode" preference, exposed as a
toggle in Settings and persisted across restarts. The preference SHALL default
to OFF. WHEN compact mode is enabled, every roster row SHALL omit its third
content line — the meta line carrying the context-window measure, the model
label, and the time since last activity — leaving the title and status sub-line.
WHEN compact mode is disabled (the default), rows SHALL render all three lines as
before.

#### Scenario: Compact mode hides the meta line

- **WHEN** a roster row renders while compact mode is enabled
- **THEN** the row shows its title and status sub-line but not the
  context/model/time meta line

#### Scenario: Full rows by default

- **WHEN** a roster row renders while compact mode is disabled (the default)
- **THEN** the row shows the context/model/time meta line as its third line

#### Scenario: The preference persists and defaults OFF

- **WHEN** the app loads on a fresh install with no stored compact-mode preference
- **THEN** compact mode is OFF and rows render all three lines, and a user's
  later toggle is restored on the next launch
