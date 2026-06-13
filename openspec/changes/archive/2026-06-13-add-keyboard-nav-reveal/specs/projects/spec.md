# projects (delta)

## ADDED Requirements

### Requirement: Keyboard navigation reveals the selected project filter

When keyboard navigation changes the selected project filter, the system SHALL
scroll the active project row into view within the project panel when it is not
already fully visible, so the selection never moves out of sight as the user
cycles through a panel longer than its scrollport. A selected row that is
already fully visible SHALL NOT be scrolled.

#### Scenario: Cycling to an off-screen project scrolls it into view
- **WHEN** the user cycles the project filter with the keyboard to a project whose panel row is below or above the visible portion of the panel
- **THEN** the panel scrolls so the active project row is brought into view

#### Scenario: An already-visible project filter is not scrolled
- **WHEN** keyboard navigation selects a project whose panel row is already fully visible
- **THEN** the panel scroll position is left unchanged
