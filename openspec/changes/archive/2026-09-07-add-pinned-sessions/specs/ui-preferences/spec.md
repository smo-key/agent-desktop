## MODIFIED Requirements

### Requirement: Remembered UI-layout preferences persist durably

The application SHALL persist its remembered UI-layout preferences — project-pane
collapse state, terminals-panel width, tasks-launcher split fraction, selected
project filter, the manual order of the draggable lanes, and the list of pinned
sessions — in the durable `ui` slice of `settings.json`, so they survive an
application restart including an abrupt or unclean exit. These preferences SHALL
NOT be stored in `localStorage`.

#### Scenario: Pinned ids persist in the ui slice and non-string ids are dropped

- **WHEN** the persisted `ui` slice carries a `pinned` list
- **THEN** its string pane ids are restored in order, non-string entries are
  dropped, and a missing or malformed list defaults to empty
