# voice-dictation Specification Delta

## ADDED Requirements

### Requirement: Recovering from a failed dictation

The voice panel SHALL remain escapable from on screen in every failure phase.
Whenever the panel is in a generic `error` or a `denied`-microphone phase it
SHALL render an explicit **retry** control and an explicit **dismiss** control
alongside the guidance message; the failure phases replace the recording row (and
its confirm/cancel controls), so guidance SHALL NOT be shown without them. Escape
remains a valid dismissal but SHALL NOT be the only way out.

Activating retry SHALL recover **in place**, without closing the panel: the error
message and any partial/final transcript are cleared, the panel returns to the
idle phase, and a NEW capture session begins. A capture session that has
finalized or failed has already released the microphone, so retry SHALL start a
fresh capture rather than reusing the spent one.

A solo right-Command tap while the panel is in a failure phase SHALL retry rather
than attempt to finalize — finalizing is a no-op in any non-recording phase, so
routing the tap there would leave the gesture inert with the error on screen.

#### Scenario: Dismissing a failed dictation

- **WHEN** the voice panel is showing an error or denied guidance message
- **THEN** the panel shows an explicit dismiss control
- **AND** activating it closes the panel and clears the failure

#### Scenario: Retrying a failed dictation

- **WHEN** the voice panel is showing an error message
- **AND** the user activates the retry control
- **THEN** the error message and any transcript are cleared
- **AND** the panel stays open and returns to the idle phase
- **AND** a fresh capture session starts

#### Scenario: Activation tap recovers from a failed dictation

- **WHEN** the voice panel is in the error or denied phase
- **AND** the user taps the right Command key
- **THEN** the system retries (fresh capture) instead of attempting to finalize

#### Scenario: Retry() while closed is a no-op

- **WHEN** the voice panel is closed
- **AND** a retry is requested
- **THEN** nothing happens and the panel stays closed

## MODIFIED Requirements

### Requirement: Microphone permission handling

The system SHALL request microphone permission before capturing audio. If
permission is denied, the system SHALL display guidance directing the user to
grant access in macOS System Settings and SHALL NOT silently fail. Recording
SHALL NOT proceed until permission is granted.

Recording an error message SHALL NOT discard the `denied` phase: the denied phase
carries the System Settings guidance, so setting the error text SHALL preserve it
rather than collapsing it into the generic error phase. The denied guidance SHALL
remain recoverable — see "Recovering from a failed dictation".

#### Scenario: Permission granted

- **WHEN** the user opens the panel and grants microphone permission
- **THEN** recording begins

#### Scenario: Permission denied

- **WHEN** microphone permission is denied
- **THEN** the panel shows guidance to enable microphone access in System Settings
- **AND** no audio is captured

#### Scenario: Permission denied guidance survives the error message

- **WHEN** microphone permission is denied and the denial message is recorded
- **THEN** the panel stays in the denied phase (not the generic error phase)
- **AND** the System Settings hint remains visible
