## MODIFIED Requirements

### Requirement: Live partial transcription

The system SHALL produce low-latency partial transcripts during recording using a
persistent, in-memory whisper server (a long-lived `whisper-server` process with
the tiny model loaded once), so partials do not pay a per-pass model reload. The
live overlay SHALL accumulate the ENTIRE spoken message by transcribing only NEW
audio and concatenating it onto the already-transcribed text — the system SHALL
NOT re-transcribe the whole utterance on each update. New audio MAY be finalized in
segments cut on silence boundaries (with a maximum segment length so continuous
speech still advances); the current unfinalized tail MAY be shown as a bounded live
preview. If the whisper server cannot be started or does not respond, the system
SHALL degrade gracefully — partials simply do not appear — without blocking
recording or affecting the final high-quality pass.

#### Scenario: Partials accumulate the whole message as the user speaks

- **WHEN** the user is speaking with the panel open
- **THEN** newly spoken audio is transcribed and appended to the live overlay
- **AND** the overlay shows the whole message so far, not just a trailing window

#### Scenario: New speech is appended without reprocessing earlier text

- **WHEN** the user continues speaking after earlier speech has been transcribed
- **THEN** only the new audio is transcribed and concatenated
- **AND** the already-transcribed portion of the message is not re-transcribed

#### Scenario: Whisper server unavailable degrades gracefully

- **WHEN** the persistent whisper server cannot start or does not respond
- **THEN** no live partials are shown
- **AND** recording continues and the final high-quality pass still produces the transcript
