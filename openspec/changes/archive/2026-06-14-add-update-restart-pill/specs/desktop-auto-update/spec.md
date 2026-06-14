## ADDED Requirements

### Requirement: Background staging of available updates

The app SHALL download and stage an available update in the background, without a
blocking dialog, both when the on-launch update prompt is declined ("Later") and
on a recurring background re-check that runs approximately hourly for the lifetime
of the session — so the update can be applied on the user's next restart. A
recurring check or background download that fails (e.g. offline) continues
silently with nothing surfaced and nothing staged.

#### Scenario: Recurring check finds and stages an update

- **WHEN** the app has been running and a newer version is published
- **THEN** approximately one hour after launch a background check finds it and
  downloads + stages it, with no dialog shown

#### Scenario: Declining the launch prompt stages in the background

- **WHEN** the on-launch update prompt is shown and the user chooses "Later"
- **THEN** the app downloads + stages the update in the background instead of
  discarding it for the session

#### Scenario: Background check or download failure is silent

- **WHEN** a recurring check or a background download fails (offline / IPC error)
- **THEN** the app continues normally, no error is surfaced, and no update is
  staged

#### Scenario: An already-staged version is not re-downloaded

- **WHEN** a check returns the same version that is already downloading or staged
- **THEN** no second download starts and no duplicate restart affordance appears

### Requirement: Update-ready restart pill

The app SHALL display an orange "Restart to update" pill, with a gift icon, in the
title bar's right-hand controls as their leftmost item whenever an update has been
downloaded and staged; activating the pill installs the staged update and
relaunches the app into the new version. No pill is shown when no update is staged,
including outside the Tauri runtime or after a failed check.

#### Scenario: Pill appears when an update is staged

- **WHEN** an update has been downloaded and staged
- **THEN** an orange "Restart to update" pill with a gift icon appears as the
  leftmost item of the title bar's right-side controls

#### Scenario: Activating the pill installs and relaunches

- **WHEN** the user clicks the "Restart to update" pill
- **THEN** the staged update is installed and the app relaunches into the new
  version

#### Scenario: No pill without a staged update

- **WHEN** no update has been staged — including outside the Tauri runtime, or
  after a check or download failed
- **THEN** no restart pill is shown
