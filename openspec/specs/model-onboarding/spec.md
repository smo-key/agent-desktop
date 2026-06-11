# model-onboarding Specification

## Purpose
TBD - created by syncing change add-first-launch-model-gate. Update Purpose after archive.
## Requirements

### Requirement: First-launch model gate when required models are missing

The app SHALL present a full-screen onboarding gate on launch whenever the
on-device model files the current voice selection requires are missing from disk
AND the user has not previously seen the gate, before the workspace is usable. The
gate SHALL explain the one-time on-device download and SHALL list the models to be
downloaded with a human-readable size for each and a total. When all required models
are already present, the app SHALL load directly to the workspace with no gate.

Detection of missing models SHALL be presence-based. The gate SHALL be shown at most
ONCE per user: once the user has been presented with and finished interacting with the
gate (see "Showing the gate only once per user"), it SHALL NOT be shown again on any
later launch, independent of whether the required model files are present.

#### Scenario: Required models missing on launch, gate not yet seen

- **WHEN** the app starts, one or more required model files are not on disk, and the
  user has not previously seen the onboarding gate
- **THEN** the full-screen onboarding gate is shown listing the missing models and
  their total download size before the workspace is usable

#### Scenario: All required models present

- **WHEN** the app starts and every required model file is already on disk
- **THEN** no onboarding gate is shown and the workspace loads directly

### Requirement: Download from the gate with live progress

The gate SHALL offer a primary action to download the required models, driving the
existing model-download flow and showing live overall progress. On successful
completion the gate SHALL dismiss and reveal the workspace. If the download fails,
the gate SHALL surface the error and offer a retry rather than dismissing.

#### Scenario: User downloads the models

- **WHEN** the user activates the download action in the gate
- **THEN** the required models download with a visible progress indicator, and the
  gate dismisses to the workspace once they are all present

#### Scenario: Download fails

- **WHEN** a model download from the gate fails
- **THEN** the gate shows the error and offers a retry, and does not dismiss

### Requirement: Model downloads work behind TLS-inspecting corporate proxies

Model downloads SHALL succeed on corporate networks that perform TLS inspection,
including networks that steer traffic per process and drop the connections of
in-process HTTP clients while allowing established system tools through.

To achieve this, model downloads SHALL be performed by shelling out to the
system `curl` binary rather than an in-process HTTP client. Per-model the
download SHALL: write to a sibling `<filename>.part` temp file, follow redirects,
fail (and surface the error) on a non-success HTTP status, then atomically rename
the completed file into place. Progress SHALL still be reported (e.g. by polling
the partial file's size against the registry size estimate) so the gate's
progress indicator continues to advance.

The implementation SHALL avoid the common corporate-machine misconfiguration
where a `CURL_CA_BUNDLE` environment variable points at a missing certificate
bundle (which would make `curl` abort before connecting).

#### Scenario: Download behind a per-process TLS-inspecting proxy

- **WHEN** the model download runs on a network whose proxy drops the TLS
  connections of in-process HTTP clients but allows the system `curl` binary
- **THEN** the download is carried out by `curl` and completes, rather than
  failing with a dropped-connection / unexpected-EOF error

#### Scenario: A download fails under curl

- **WHEN** the spawned `curl` exits non-zero for a model (e.g. HTTP error or a
  network failure)
- **THEN** that model surfaces a download error (and the gate offers retry),
  the partial file is cleaned up, and remaining models are still attempted

### Requirement: Skip enters the app and is permanent

The gate SHALL offer a secondary action to skip the download and enter the app.
Skipping SHALL leave voice and session-title features gracefully disabled until the
models are present. Skipping SHALL mark the gate as seen so that it is NOT shown
again on any later launch, even while the required models remain missing.

#### Scenario: User skips the download

- **WHEN** the user activates the skip action in the gate
- **THEN** the gate dismisses, the workspace loads, voice/title features remain
  disabled until the models are downloaded, and the gate is not shown again on a
  later launch

### Requirement: Showing the gate only once per user

The onboarding gate SHALL be shown to a given user at most once. The app SHALL
persist a one-time "seen" flag the moment the user finishes with the gate — either by
skipping or by completing the download — and SHALL consult that flag on every launch
before deciding to show the gate. Once the flag is set, the gate SHALL NOT be shown
again regardless of whether the required model files are present or missing.

#### Scenario: Gate not shown again after it was skipped

- **WHEN** the user skipped the gate on a previous launch and the required models are
  still missing on a later launch
- **THEN** the gate is not shown and the workspace loads directly

#### Scenario: Gate not shown again after a completed download

- **WHEN** the user completed the model download on a previous launch
- **THEN** the gate is not shown on later launches, and it is not shown again even if
  the model files later become missing

#### Scenario: Returning user sees no flash of the gate

- **WHEN** the app starts for a user who has already seen the gate
- **THEN** the persisted "seen" flag is consulted before the presence check resolves
  so the gate is never briefly shown

### Requirement: Delete downloaded models from Settings

The Settings UI SHALL provide a control to delete the downloaded on-device models
and reclaim their disk space. The control SHALL display the total reclaimable size
and SHALL be unavailable (or indicate "none downloaded") when no downloaded models
are present.

Activating the control SHALL delete every downloaded model file (the whisper tier
models and the polish LLM) together with any interrupted-download `.part` leftover,
and SHALL NOT delete the bundled model (which ships with the app and is never a
downloaded file). Deletion SHALL be best-effort and idempotent: an already-absent
file is a no-op, and one file that cannot be removed SHALL NOT abort removal of the
others. After deletion the Settings UI SHALL reflect the freed state — the affected
models appear as available to download again — and any model needed later is
re-downloaded on demand.

#### Scenario: Delete downloaded models frees disk space

- **WHEN** one or more downloaded models are present and the user activates the
  delete control in Settings
- **THEN** those model files (and any `.part` leftovers) are removed, the reclaimed
  size is freed, and the UI updates to show the models as downloadable again

#### Scenario: Nothing to delete when no models are downloaded

- **WHEN** no downloaded models are present on disk
- **THEN** the delete control is unavailable (it indicates there is nothing to
  reclaim) rather than performing a no-op deletion

#### Scenario: Bundled model is never deleted

- **WHEN** the user deletes downloaded models
- **THEN** the bundled model is preserved, so first-run/offline transcription keeps
  working after the deletion
