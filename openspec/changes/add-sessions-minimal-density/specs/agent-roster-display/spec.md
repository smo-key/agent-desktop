## MODIFIED Requirements

### Requirement: Compact mode hides the roster row's meta line

The sessions panel SHALL offer a density preference, exposed in Settings as a
"Default" / "Compact" / "Minimal" dropdown shown as the FIRST setting, and
persisted across restarts. The preference SHALL default to "Default". WHEN
"Compact" is selected, every roster row SHALL omit its third content line — the
meta line carrying the context-window measure, the model label, and the time
since last activity — leaving the title and status sub-line. WHEN "Minimal" is
selected, every roster row SHALL keep only its title beside a smaller project
icon, omitting both the status sub-line and the meta line. WHEN "Default" is
selected (the default), rows SHALL render all three lines as before. A legacy
persisted `{ enabled: true }` compact-mode slice SHALL be read as "Compact".

#### Scenario: Compact mode hides the meta line

- **WHEN** a roster row renders while compact mode is enabled
- **THEN** the row shows its title and status sub-line but not the
  context/model/time meta line

#### Scenario: Minimal density keeps only the title and a smaller icon

- **WHEN** a roster row renders while the density is "Minimal"
- **THEN** the row shows its title beside a project icon smaller than the
  Default/Compact icon, and neither the status sub-line nor the meta line

#### Scenario: Full rows by default

- **WHEN** a roster row renders while compact mode is disabled (the default)
- **THEN** the row shows the context/model/time meta line as its third line

#### Scenario: The preference persists and defaults to Default

- **WHEN** the app loads on a fresh install with no stored density preference
- **THEN** the density is "Default" and rows render all three lines, and a user's
  later "Compact" or "Minimal" selection is restored on the next launch

#### Scenario: A legacy boolean compact-mode slice reads as Compact

- **WHEN** the persisted `compactMode` slice is the pre-density `{ enabled: true }`
  shape with no `density` field
- **THEN** the density resolves to "Compact", and `{ enabled: false }` or an
  unknown `density` value resolves to "Default"
