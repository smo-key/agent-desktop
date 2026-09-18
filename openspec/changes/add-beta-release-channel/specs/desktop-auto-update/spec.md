## MODIFIED Requirements

### Requirement: Updater plugin configured against GitHub Releases

The app SHALL integrate the Tauri updater plugin, configured with the committed public key used to verify update signatures and with **one update endpoint per release channel**, both served from the project's GitHub Releases.

The configured endpoints SHALL be, in order:

1. the **stable** manifest, `releases/latest/download/latest.json` — which GitHub
   resolves to the newest non-prerelease Release;
2. the **beta** manifest, `releases/download/beta-channel/latest.json` — a pinned
   prerelease whose asset is replaced by each beta publish.

A single update check SHALL use the endpoint(s) for the selected channel only; it
SHALL NOT fall through from one channel's endpoint to another's, because the
plugin's built-in multi-endpoint behavior selects the first endpoint that
responds rather than the highest version.

#### Scenario: Updater configured

- **WHEN** the app is built
- **THEN** it includes the updater plugin configured with the stable and beta
  `latest.json` endpoints and the public verification key

### Requirement: In-app update check on launch

On launch the app SHALL check its selected release channel for an available update and, when a newer version is found, download and stage it in the background — with no dialog or prompt — surfacing progress through the title-bar update indicator so the user can apply it on their next restart. When no update is available or the check fails (e.g. offline), the app SHALL continue normally without blocking startup or surfacing an error to the user.

The launch check SHALL read the persisted channel preference, so an app that was
switched to `beta` in a previous session follows the beta channel from its next
launch onward.

#### Scenario: Update available on launch

- **WHEN** the app launches and a newer version is published
- **THEN** the update is downloaded and staged in the background with no dialog
  shown, and progress is surfaced in the title-bar indicator

#### Scenario: No update or check fails on launch

- **WHEN** the app launches and there is no newer version, or the update check
  fails (e.g. the device is offline)
- **THEN** the app continues running normally with no error surfaced and no
  blocking of startup

#### Scenario: Launch check follows the stored channel

- **WHEN** the app launches with `beta` stored as the release channel
- **THEN** the launch check considers the beta channel's candidates rather than
  only the stable manifest

## ADDED Requirements

### Requirement: The update check resolves its endpoint at runtime from the channel

The update check SHALL be performed by an application-owned backend command that builds the updater with the endpoint(s) for the currently selected channel, rather than relying on the endpoint order in the plugin's static configuration.

The command SHALL take the channel as an argument, resolve the endpoint URLs from
the app's own updater configuration (so the URLs remain single-sourced in
`tauri.conf.json`), and return the update candidate in the **same metadata shape
the updater plugin's own check returns** — including a resource id registered in
the calling webview's resource table.

Returning that shape is what keeps the rest of the update path unchanged: the
frontend reconstructs the plugin's `Update` object from the metadata, and the
existing download, progress-event, install and relaunch flow continues to run
through the plugin's own commands.

Every existing caller — the launch check, the hourly background poll, the
retry affordance on a failed download, and the manual check in Settings — SHALL
go through this one command, so all four follow the selected channel with no
change to their own signatures.

#### Scenario: Check uses the selected channel's endpoint

- **WHEN** an update check runs with the channel set to `beta`
- **THEN** the updater is built against the beta endpoint (and the stable
  endpoint, for the highest-version comparison) rather than the configured
  first endpoint alone

#### Scenario: Download and install are unchanged

- **WHEN** the channel-aware check returns a candidate
- **THEN** the frontend downloads and installs it through the updater plugin's
  existing commands, with the same background staging, progress reporting and
  "Restart to update" behavior as before this change

#### Scenario: A losing candidate is not leaked

- **WHEN** a beta-channel check obtains a candidate from both manifests and keeps
  the higher-versioned one
- **THEN** the rejected candidate's backend resource is released, so a recurring
  hourly check does not accumulate handles

#### Scenario: Check failure stays silent

- **WHEN** the channel-aware check fails (offline, a missing manifest, or the
  command being unavailable outside the desktop runtime)
- **THEN** the failure is reported as a check error that background callers
  swallow silently, exactly as the previous check did
