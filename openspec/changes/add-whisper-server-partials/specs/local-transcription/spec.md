## MODIFIED Requirements

### Requirement: Live partial transcription

The system SHALL produce low-latency partial transcripts during recording using a
persistent, in-memory whisper server (a long-lived `whisper-server` process with
the tiny model loaded once), so partials do not pay a per-pass model reload. The
live overlay SHALL retain the ENTIRE spoken message — older text SHALL NOT be
dropped as the utterance grows. Each update SHALL re-transcribe only a bounded
trailing window of recent audio (a sliding window on the order of a few seconds);
audio older than that window SHALL be finalized once into committed text and SHALL
NOT be re-transcribed. The overlay SHALL show the committed text concatenated with
the current re-transcribed window. If the whisper server cannot be started or does
not respond, the system SHALL degrade gracefully — partials simply do not appear —
without blocking recording or affecting the final high-quality pass.

#### Scenario: The whole message is retained as the user keeps talking

- **WHEN** the user speaks for longer than the reprocess window
- **THEN** text older than the window remains visible in the overlay (it is not dropped)
- **AND** the overlay shows the whole message so far

#### Scenario: Only the recent window is reprocessed

- **WHEN** a partial update occurs during a long utterance
- **THEN** only the trailing window of recent audio is re-transcribed
- **AND** the already-finalized (older) portion of the message is not re-transcribed

#### Scenario: Whisper server unavailable degrades gracefully

- **WHEN** the persistent whisper server cannot start or does not respond
- **THEN** no live partials are shown
- **AND** recording continues and the final high-quality pass still produces the transcript
