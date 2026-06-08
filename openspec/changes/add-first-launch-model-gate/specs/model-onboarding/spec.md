# model-onboarding

## ADDED Requirements

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
