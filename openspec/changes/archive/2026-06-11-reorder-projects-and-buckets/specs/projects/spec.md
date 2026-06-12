## ADDED Requirements

### Requirement: Reorder Projects By Dragging
The system SHALL let the user reorder the project list by dragging a project row
onto another, moving the dragged project to the drop target's slot. The new order
SHALL be persisted with the project list (the sibling `projects.json`) so it
survives a restart, and SHALL drive both the expanded panel and the collapsed icon
rail (which mirror the same list). A drag that resolves to no movement (an unknown
project, or a drop onto itself) SHALL leave the list unchanged.

#### Scenario: Reordering a project by dragging lands it at the drop target
- **WHEN** a project is dragged and dropped onto another project in the list
- **THEN** the dragged project is moved to the drop target's position (the standard array-move keyed by id), the rest keep their relative order, and the new order is persisted
- **AND** a drag with an unknown id, or a drop onto the same project, leaves the order unchanged
