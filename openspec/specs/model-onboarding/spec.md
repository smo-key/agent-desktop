# model-onboarding Specification

## Purpose
TBD - created by syncing change add-first-launch-model-gate. Update Purpose after archive.
## Requirements

### Requirement: First-launch model gate when required models are missing

The app SHALL present a full-screen onboarding gate on launch whenever the
on-device model files the current voice selection requires are missing from disk,
before the workspace is usable. The gate SHALL explain the one-time on-device
download and SHALL list the models to be downloaded with a human-readable size for
each and a total. When all required models are already present, the app SHALL load
directly to the workspace with no gate.

Detection SHALL be presence-based: the gate is shown whenever required model files
are absent and never once they are on disk.

#### Scenario: Required models missing on launch

- **WHEN** the app starts and one or more required model files are not on disk
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

Model downloads SHALL succeed on corporate networks that perform TLS inspection.
This has two parts:

1. **Trust.** Downloads SHALL validate TLS against the operating system trust
   store, so that an internal CA installed in the OS keychain — which re-signs
   upstream certificates — is honored. The download client SHALL NOT rely solely
   on a bundled certificate set that ignores OS-installed trust anchors.
2. **Connection protocol.** The download client SHALL negotiate a connection
   protocol the proxy reliably supports. Because some inspecting proxies mishandle
   HTTP/2 and tear the connection down mid-handshake, the client SHALL constrain
   itself to HTTP/1.1 for model downloads rather than offering HTTP/2 via ALPN.

#### Scenario: Download behind a TLS-inspecting proxy

- **WHEN** the model download runs on a network whose TLS-inspecting proxy
  re-signs the connection with a CA that is trusted by the OS but not part of any
  bundled root set
- **THEN** the TLS handshake succeeds and the download proceeds, rather than
  failing with an unknown-issuer / invalid-certificate error

#### Scenario: Proxy that mishandles HTTP/2

- **WHEN** the model download runs through an inspecting proxy that closes the
  connection when the client offers HTTP/2
- **THEN** the download still completes over HTTP/1.1 rather than failing with an
  unexpected-EOF / connection-closed error

### Requirement: Skip defers the download for the session

The gate SHALL offer a secondary action to skip the download and enter the app.
Skipping SHALL leave voice and session-title features gracefully disabled until the
models are present. A skip SHALL apply only to the current session: the gate is not
shown again during this session, but is offered again on the next launch while the
required models remain missing.

#### Scenario: User skips the download

- **WHEN** the user activates the skip action in the gate
- **THEN** the gate dismisses, the workspace loads, and voice/title features remain
  disabled until the models are downloaded

#### Scenario: Skip does not nag within the session

- **WHEN** the user has skipped the gate this session and the required models are
  still missing
- **THEN** the gate is not shown again for the remainder of the session

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
