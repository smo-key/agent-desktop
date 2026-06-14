## MODIFIED Requirements

### Requirement: In-app update check on launch

On launch the app SHALL check for an available update and, when a newer version is found, download and stage it in the background — with no dialog or prompt — surfacing progress through the title-bar update indicator so the user can apply it on their next restart. When no update is available or the check fails (e.g. offline), the app SHALL continue normally without blocking startup or surfacing an error to the user.

#### Scenario: Update available on launch

- **WHEN** the app launches and a newer version is published
- **THEN** the update is downloaded and staged in the background with no dialog
  shown, and progress is surfaced in the title-bar indicator

#### Scenario: No update or check fails on launch

- **WHEN** the app launches and there is no newer version, or the update check
  fails (e.g. the device is offline)
- **THEN** the app continues running normally with no error surfaced and no
  blocking of startup

### Requirement: Background staging of available updates

The app SHALL download and stage an available update in the background, without any blocking dialog, on the launch check and on a recurring background re-check that runs approximately hourly for the lifetime of the session — so the update can be applied on the user's next restart. A recurring or launch check that fails (e.g. offline) with no update found SHALL continue silently, with nothing surfaced in the title bar and nothing staged.

#### Scenario: Recurring check finds and stages an update

- **WHEN** the app has been running and a newer version is published
- **THEN** approximately one hour after launch a background check finds it and
  downloads + stages it, with no dialog shown

#### Scenario: Launch check stages in the background

- **WHEN** the app launches and a newer version is available
- **THEN** it downloads + stages the update in the background with no dialog,
  rather than prompting the user

#### Scenario: Background check failure is silent

- **WHEN** a recurring or launch update check fails (offline / IPC error) with no
  update found
- **THEN** the app continues normally, no error is surfaced in the title bar, and
  no update is staged

#### Scenario: An already-staged version is not re-downloaded

- **WHEN** a check returns the same version that is already downloading or staged
- **THEN** no second download starts and no duplicate restart affordance appears

### Requirement: Update-ready restart pill

The app SHALL display the update indicator in the title bar's right-hand controls, as their leftmost item, whenever an update is downloading, staged, installing, or has failed to download; when an update has been downloaded and staged it shows an orange "Restart to update" pill with a gift icon, and activating it installs the staged update and relaunches into the new version. No indicator is shown when idle — no update downloading, staged, installing, or failed — including outside the Tauri runtime.

#### Scenario: Pill appears when an update is staged

- **WHEN** an update has been downloaded and staged
- **THEN** an orange "Restart to update" pill with a gift icon appears as the
  leftmost item of the title bar's right-side controls

#### Scenario: Activating the pill installs and relaunches

- **WHEN** the user clicks the "Restart to update" pill
- **THEN** the staged update is installed, the indicator shows a "Restarting…"
  state, and the app relaunches into the new version

#### Scenario: No indicator when idle

- **WHEN** no update is downloading, staged, installing, or failed — including
  outside the Tauri runtime
- **THEN** no update indicator is shown in the title bar

## ADDED Requirements

### Requirement: Update download progress in the title bar

The app SHALL surface download progress in the title-bar indicator while an update is downloading, showing the percentage downloaded when the update manifest reports a total content length and an indeterminate "Updating…" state when it does not. The downloading indicator SHALL NOT be activatable — clicking it does nothing until the update is staged.

#### Scenario: Determinate progress

- **WHEN** an update is downloading and the manifest reports a total content length
- **THEN** the title-bar indicator shows "Updating… N%" reflecting bytes downloaded
  over the total

#### Scenario: Indeterminate progress

- **WHEN** an update is downloading and the manifest reports no content length
- **THEN** the title-bar indicator shows an indeterminate "Updating…" state with no
  percentage

#### Scenario: Downloading indicator is not activatable

- **WHEN** the indicator is in the downloading state and the user clicks it
- **THEN** nothing happens and the download continues

### Requirement: Retryable update-download failure

The app SHALL surface a retryable "Update failed · retry" state in the title-bar indicator when an update was found but its background download or staging fails; activating it re-checks for the update and re-attempts the download. This download failure is distinct from a routine check failure (offline / no manifest with no update found), which stays silent in the title bar. The failed state SHALL clear automatically when a subsequent check or download succeeds.

#### Scenario: Download failure surfaces a retry affordance

- **WHEN** an update was found and its background download or staging fails
- **THEN** the title-bar indicator shows "Update failed · retry"

#### Scenario: Retrying re-attempts the update

- **WHEN** the user activates the "Update failed · retry" indicator
- **THEN** the app re-checks for the update and re-attempts the download

#### Scenario: Check failure does not surface a header failure

- **WHEN** a routine background check fails (offline / IPC error) with no update
  found
- **THEN** no failed indicator is shown in the title bar

#### Scenario: Failed state clears on success

- **WHEN** a download had failed and a later check or download succeeds
- **THEN** the failed indicator is cleared, replaced by the appropriate
  downloading or ready state, or hidden

### Requirement: Manual check for updates in Settings

Settings SHALL display the current application version and provide a "Check for updates" control that, on demand, checks for a newer version and drives the same background updater, showing inline status for the result: checking, downloading with progress, an update staged and ready to restart, already up to date, or a check that could not complete (retryable). Unlike the silent background path, a manual check that fails SHALL surface the failure inline.

#### Scenario: Current version shown

- **WHEN** the user opens the update section of Settings
- **THEN** the current application version is displayed

#### Scenario: Manual check finds an update

- **WHEN** the user activates "Check for updates" and a newer version is available
- **THEN** it downloads + stages the update in the background, showing inline
  progress and, once staged, an "Update ready — restart" affordance

#### Scenario: Manual check finds no update

- **WHEN** the user activates "Check for updates" and the app is already current
- **THEN** it shows a "You're up to date" status inline

#### Scenario: Manual check fails

- **WHEN** the user activates "Check for updates" and the check cannot complete
  (e.g. offline)
- **THEN** it shows a retryable "Couldn't check — retry" status inline
