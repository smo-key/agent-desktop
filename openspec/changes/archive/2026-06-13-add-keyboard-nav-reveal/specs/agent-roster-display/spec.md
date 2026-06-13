# agent-roster-display (delta)

## ADDED Requirements

### Requirement: Keyboard navigation reveals the selected session

When keyboard navigation changes the selected session, the system SHALL scroll the selected row into view within the session list when it is not already fully visible, so the selection never moves out of sight. A selection that is already fully visible SHALL NOT be scrolled. The reveal SHALL apply to the selected row in any lane and to the pinned-coordinator / start-affordance slot when it is the selection.

#### Scenario: Stepping to an off-screen session scrolls it into view
- **WHEN** the user steps the session selection with the keyboard to an agent whose row is below or above the visible portion of the list
- **THEN** the list scrolls so the newly-selected row is brought into view

#### Scenario: An already-visible selection is not scrolled
- **WHEN** keyboard navigation selects a session whose row is already fully visible in the list
- **THEN** the list scroll position is left unchanged

### Requirement: Navigating to a hidden archived session expands the Archived lane

When keyboard navigation selects an archived session hidden beyond the Archived lane's collapsed preview, the system SHALL expand the Archived lane (equivalent to "Show all") so the selected row is rendered and can be revealed. The expansion SHALL be one-way (the lane is not auto-collapsed afterward), and SHALL occur only while the lane is collapsed and the selected archived row sits beyond the preview. The auto-expansion SHALL fire only on a change of selection, so that the user can still manually collapse the lane afterward without it immediately re-expanding while the same archived row remains selected.

#### Scenario: Selecting a hidden archived session shows all archived rows
- **WHEN** the Archived lane is collapsed to its preview and keyboard navigation selects an archived session beyond that preview
- **THEN** the Archived lane expands to show all archived rows and the selected row is then revealed in the list

#### Scenario: Selecting a previewed archived session does not change expansion
- **WHEN** keyboard navigation selects an archived session that is already within the collapsed preview
- **THEN** the Archived lane's expansion state is unchanged

#### Scenario: Navigating away does not re-collapse the lane
- **WHEN** the Archived lane was auto-expanded by navigation and the selection then moves to a non-archived session
- **THEN** the Archived lane stays expanded (the reveal is one-way)

#### Scenario: Manually collapsing after an auto-expand stays collapsed
- **WHEN** the Archived lane was auto-expanded because a hidden archived session is selected, and the user then manually collapses the lane without changing the selection
- **THEN** the Archived lane stays collapsed (the auto-expansion does not re-fire for the still-selected row)
