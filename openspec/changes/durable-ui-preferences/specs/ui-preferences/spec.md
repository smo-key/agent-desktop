## ADDED Requirements

### Requirement: Remembered UI-layout preferences persist durably

The application SHALL persist its remembered UI-layout preferences — project-pane
collapse state, terminals-panel width, tasks-launcher split fraction, selected
project filter, and the manual order of the draggable lanes — in the durable
`ui` slice of `settings.json`, so they survive an application restart including an
abrupt or unclean exit. These preferences SHALL NOT be stored in `localStorage`.

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
  the documented defaults apply without error

#### Scenario: Out-of-range or malformed stored values are normalized

- **WHEN** the persisted `ui` slice contains an out-of-range number (a width or
  split fraction beyond its bounds), a wrong-typed field, or non-string lane ids
- **THEN** numbers are clamped into their valid range, wrong-typed fields fall
  back to their per-field default, and non-string lane ids are dropped

#### Scenario: Lane order is not overwritten before it hydrates

- **WHEN** the overview mounts before the persisted `ui` slice has finished
  loading
- **THEN** lane reconciliation is held off until the saved order has hydrated and
  seeded
- **AND** a returning agent keeps its saved slot rather than being reordered by
  mount order

### Requirement: localStorage is reserved for regenerable caches

The application SHALL restrict `localStorage` to regenerable session caches (whose
loss merely triggers a recompute) and SHALL NOT use it for durable preferences. A
build gate SHALL fail when any source file outside an explicit regenerable-cache
allowlist accesses `localStorage`.

#### Scenario: A new non-cache localStorage use fails the build

- **WHEN** a source file outside the regenerable-cache allowlist accesses
  `localStorage`
- **THEN** the `localStorage` gate (run by the pre-commit hook and `check:gate`)
  exits non-zero and reports the offending file and line

#### Scenario: Allowlisted regenerable caches are permitted

- **WHEN** the session title, summary, or cost cache (each regenerable from the
  transcript) uses `localStorage`
- **THEN** the gate passes, because those files are on the allowlist
