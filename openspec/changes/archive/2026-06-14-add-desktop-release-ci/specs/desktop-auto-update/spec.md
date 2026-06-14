## ADDED Requirements

### Requirement: Updater plugin configured against GitHub Releases

The app SHALL integrate the Tauri updater plugin, configured with an update
endpoint served from the project's GitHub Releases (`latest.json`) and the
committed public key used to verify update signatures.

#### Scenario: Updater configured

- **WHEN** the app is built
- **THEN** it includes the updater plugin configured with the GitHub Release
  `latest.json` endpoint and the public verification key

### Requirement: Signed update artifacts published

For each release, the pipeline SHALL produce the per-platform signed update
bundles and a `latest.json` manifest and SHALL attach them to the GitHub Release,
so installed apps can discover and verify the new version.

#### Scenario: Update manifest attached

- **WHEN** a release `vX` is published
- **THEN** the platform update bundles and a `latest.json` pointing at version `X`
  are attached to the release

#### Scenario: Update signature verifies

- **WHEN** an installed app fetches an update bundle for `vX`
- **THEN** its signature verifies against the app's committed public key before
  installation proceeds

### Requirement: In-app update check on launch

On launch the app SHALL check for an available update; when one is found it SHALL
prompt the user and, on confirmation, download, verify, and install it. When no
update is available or the check fails (e.g. offline), the app SHALL continue
normally without blocking startup or surfacing an error to the user.

#### Scenario: Update available

- **WHEN** the app launches and a newer version is published
- **THEN** the user is prompted, and on confirmation the update is downloaded,
  verified, and installed

#### Scenario: No update or check fails

- **WHEN** the app launches and there is no newer version, or the update check
  fails (e.g. the device is offline)
- **THEN** the app continues running normally with no error surfaced and no
  blocking of startup
