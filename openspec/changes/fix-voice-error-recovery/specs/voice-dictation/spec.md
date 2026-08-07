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
message and the in-progress partial transcript are cleared, the panel returns to
the idle phase, and a NEW capture session begins. A capture session that has
finalized or failed has already released the microphone, so retry SHALL start a
fresh capture rather than reusing the spent one. Retry SHALL also re-check model
readiness, so a "models aren't ready" failure can actually be recovered from.

Retry SHALL NOT discard a COMPLETED transcript. Some failures occur after a
successful transcription — a dead pane or no focused agent means the *insert*
failed, not the dictation — and the panel stays open specifically so that text is
not lost. In those phases the panel SHALL display the completed transcript
alongside the guidance, and retry SHALL preserve it. The preserved transcript
SHALL be superseded once a new capture actually begins recording, and the live
recording/finalizing rows SHALL show only the current utterance — a preserved
transcript SHALL NOT be rendered as if it were the one being captured now.

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
- **THEN** the error message and the in-progress partial transcript are cleared
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

#### Scenario: Retry preserves a completed transcript from a failed insert

- **WHEN** dictation transcribed successfully but the insert failed (dead pane or no agent)
- **AND** the user activates retry
- **THEN** the completed transcript is preserved, not discarded

### Requirement: Abandoned capture sessions never deliver their result

Each opening or retry of the voice panel SHALL begin a distinct capture session.
Finalization work that outlives its session — the whole-utterance final pass and
the polish pass both run for seconds — SHALL be discarded rather than applied:
once the user has dismissed the panel or started another capture, the abandoned
utterance SHALL NOT be inserted into a terminal, SHALL NOT spawn an agent, and
SHALL NOT write its result or its error over the live session.

#### Scenario: Discarded dictation is never inserted

- **WHEN** the user confirms a dictation and then dismisses the panel while it is still transcribing
- **THEN** the finished text is never inserted and no agent is spawned for it

#### Scenario: A stale result does not disturb a newer session

- **WHEN** a finalization from an abandoned session completes after the user has started a new capture
- **THEN** the new session's phase, transcript, and panel visibility are left untouched

### Requirement: Model downloads never overlap

Model downloads SHALL be serialized: at most one SHALL run at a time, and
repeated identical requests SHALL collapse into one. The downloader
clears and renames a `.part` file per model and readiness is an existence check,
so overlapping downloads of the same model leave a truncated file reported as
ready. Retrying model readiness is a user-reachable action, so it SHALL be safe to
trigger repeatedly.

Only the download SHALL be serialized. The readiness check SHALL NOT queue behind
an in-flight download: transfers have no timeout, so a stalled one would otherwise
block every later caller — including the retry control whose purpose is to
re-check. A download SHALL always clear its in-progress indicator, including when
it fails before starting. A readiness check that finds nothing to download SHALL
NOT clear the in-progress state of a download that is still running.

#### Scenario: Collapses concurrent calls into a single download

- **WHEN** model readiness is requested twice for the same selection while a download is in flight
- **THEN** only one download runs and both callers observe the same result

#### Scenario: Runs a later download after the first finishes, never overlapping

- **WHEN** readiness is requested for a different selection while a download is in flight
- **THEN** the second download starts only after the first completes

#### Scenario: A readiness check does not clobber a live download session

- **WHEN** one selection is mid-download
- **AND** readiness is checked for a different selection whose models are already present
- **THEN** the running download keeps ownership of the progress state

#### Scenario: A readiness check still resolves while a download is stalled

- **WHEN** a download has stalled and never returns
- **AND** readiness is requested for a selection whose models are already present
- **THEN** that request resolves rather than queueing behind the stalled download

### Requirement: Microphone release on every teardown path

The system SHALL release the microphone on every path that ends a capture,
including a teardown that races the permission request itself. When the panel is
dismissed or retried while the OS permission prompt is still open, the stream
granted afterwards SHALL be released immediately rather than left running with no
means to stop it. A capture cancelled during that window SHALL NOT report itself
as recording.

#### Scenario: Dismissing while the permission prompt is open

- **WHEN** the user dismisses or retries the panel while the microphone permission prompt is still open
- **AND** the user then grants permission
- **THEN** the microphone is released immediately and the OS mic indicator turns off

#### Scenario: Releases a stream that arrives after stop() was called

- **WHEN** a capture is stopped while its microphone request is still pending
- **AND** the request later succeeds
- **THEN** the granted stream's tracks are stopped and no recording graph is built

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
