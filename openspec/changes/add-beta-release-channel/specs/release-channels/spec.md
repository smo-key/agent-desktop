## ADDED Requirements

### Requirement: The release channel is a durable user preference

The release train the app follows SHALL be a user preference persisted in the durable `settings.json` blob under a `releaseChannel` slice, and SHALL NOT be stored in `localStorage`.

The preference has exactly two values, `stable` and `beta`. A fresh install, an
absent slice, a malformed slice, or an unrecognized value SHALL all resolve to
`stable`, so a user is never opted into prereleases by accident or by data
corruption.

Writing the slice SHALL merge into the shared settings object rather than
replacing it, so sibling settings slices are preserved.

#### Scenario: Fresh install defaults to stable

- **WHEN** the app starts with no `releaseChannel` slice stored
- **THEN** the effective channel is `stable`

#### Scenario: Malformed slice falls back to stable

- **WHEN** the stored `releaseChannel` slice is not an object, or its `channel`
  field is missing or is a value other than `stable` or `beta`
- **THEN** the effective channel is `stable` rather than an error or an
  undefined value

#### Scenario: Choice survives a restart

- **WHEN** the user selects `beta` and later restarts the app
- **THEN** the loaded channel is `beta`
- **AND** the other settings slices stored alongside it are unchanged

### Requirement: The channel is selectable at the bottom of Settings

The Settings modal SHALL expose a release-channel control in its final *Software update* section, alongside the app version and the "Check for updates" action, so the choice sits with the rest of the update surface.

The control SHALL offer exactly the two channels with plain labels ("Stable" and
"Beta"), SHALL show the currently effective channel, and SHALL describe the
beta channel as receiving earlier, less-tested builds.

#### Scenario: Switching channel from Settings

- **WHEN** the user picks a different channel in the Settings *Software update*
  section
- **THEN** the new channel is persisted immediately
- **AND** the control reflects the new selection

#### Scenario: Switching re-checks immediately

- **WHEN** the user switches channel
- **THEN** an update check for the newly selected channel starts at once, rather
  than waiting for the next hourly background check

### Requirement: Candidate releases are selected by channel

An update check SHALL consider only the release manifests that belong to the selected channel, as follows.

- On `stable`, only the stable manifest is considered. A prerelease build is
  never offered to a user on the stable channel.
- On `beta`, **both** the beta manifest and the stable manifest are considered,
  and the candidate with the **highest semantic version** wins. Semver ordering
  applies, so `0.4.0` outranks `0.4.0-beta.3`, and `0.4.0-beta.4` outranks
  `0.4.0-beta.3`.

Selecting a candidate SHALL NOT downgrade: a candidate is offered only when its
version is greater than the running app's version. A user who switches from
`beta` back to `stable` while running a prerelease therefore stays on that build
until a stable release exceeds it.

#### Scenario: Stable ignores a newer beta

- **WHEN** a user on the `stable` channel checks for updates while a higher
  prerelease version is published on the beta channel
- **THEN** no update is offered

#### Scenario: Beta takes the newer beta

- **WHEN** a user on the `beta` channel checks for updates and the beta manifest
  offers a higher version than the stable manifest
- **THEN** the beta candidate is selected

#### Scenario: Beta takes a higher stable

- **WHEN** a user on the `beta` channel checks for updates and the stable
  manifest offers a higher version than the beta manifest
- **THEN** the stable candidate is selected, so a stable hotfix that outranks the
  current beta still reaches beta users

#### Scenario: Switching back to stable does not downgrade

- **WHEN** a user running prerelease `0.4.0-beta.3` switches to the `stable`
  channel and the newest stable release is `0.3.2`
- **THEN** no update is offered and the app is not rolled back
