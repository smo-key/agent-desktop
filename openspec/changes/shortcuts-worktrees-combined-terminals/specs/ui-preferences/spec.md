## MODIFIED Requirements

### Requirement: Remembered UI-layout preferences persist durably

The application SHALL persist its remembered UI-layout preferences — project-pane
collapse state, terminals-panel width, tasks-launcher split fraction, selected
project filter, the manual order of the draggable lanes, the list of pinned
sessions, and the terminals placement — in the durable `ui` slice of
`settings.json`, so they survive an application restart including an abrupt or
unclean exit. These preferences SHALL NOT be stored in `localStorage`.

#### Scenario: A layout preference survives an abrupt restart

- **WHEN** the user changes a remembered layout preference (e.g. collapses the
  project pane) and the application later exits without a clean flush (force-quit,
  crash, or dev hot-reload)
- **THEN** the preference is written to `settings.json` at the moment it changed
- **AND** on the next launch the application restores that preference rather than
  resetting it to the default

#### Scenario: Preferences hydrate on mount and default on a fresh install

- **WHEN** the application starts
- **THEN** the UI renders immediately with default preferences
- **AND** the persisted `ui` slice is loaded once on mount and the preferences are
  corrected to the stored values
- **AND** on a fresh install (no `settings.json`, or an absent/corrupt `ui` slice)
  the defaults remain in effect

## ADDED Requirements

### Requirement: Terminals placement preference

The `ui` slice SHALL carry a `terminalsPlacement` of `panel` (terminals in the separate right-docked panel) or `combined` (terminals listed with sessions), defaulting to `panel`; any other persisted value SHALL fall back to the default. Settings SHALL expose it under the Sessions panel section as a "Terminals" dropdown.

#### Scenario: Terminals placement defaults to the separate panel
- **WHEN** the `ui` slice has no `terminalsPlacement`
- **THEN** the placement is `panel`

#### Scenario: An unknown placement value falls back to the default
- **WHEN** the persisted `terminalsPlacement` is not `panel` or `combined`
- **THEN** the placement is `panel`
