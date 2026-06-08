# local-transcription Specification

## Purpose
TBD - created by syncing change add-voice-input. Update Purpose after archive.
## Requirements
### Requirement: On-device speech-to-text

The system SHALL transcribe captured audio entirely on-device using a bundled
`whisper.cpp` engine. No audio or transcript data SHALL be sent off the device.

#### Scenario: Transcription runs locally

- **WHEN** the user dictates with the panel open
- **THEN** audio is transcribed by the local engine
- **AND** no audio or transcript is transmitted over the network

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

### Requirement: High-quality final transcription

On end-of-speech, the system SHALL run the large-v3-turbo whisper model once over
the full captured utterance to produce the final transcript used for downstream
polishing and insertion.

#### Scenario: Final pass on stop

- **WHEN** the user stops speaking and the utterance ends
- **THEN** the system runs the large-v3-turbo model over the full utterance
- **AND** produces a final transcript

### Requirement: Voice-activity detection and silence gating

The system SHALL use voice-activity detection to determine utterance boundaries
and SHALL discard silent, empty, or low-confidence segments so that no
hallucinated text is produced from silence.

#### Scenario: Silence produces no text

- **WHEN** the captured audio contains only silence or no detected speech
- **THEN** the system produces no transcript text for that segment

#### Scenario: Utterance boundary triggers final pass

- **WHEN** voice-activity detection detects the end of speech
- **THEN** the system treats the utterance as complete and triggers the final transcription pass

### Requirement: Model management

The system SHALL bundle a tiny whisper model for instant and offline first use.
The system SHALL download the large-v3-turbo model (and, when polishing is
enabled, the polish model) on first run, showing download progress, and SHALL
store downloaded models in application data rather than in the installer.

#### Scenario: Bundled model usable immediately

- **WHEN** the app is launched for the first time with no network
- **THEN** the bundled tiny model is available for transcription

#### Scenario: Download larger models with progress

- **WHEN** a required model is not present and the user first uses the feature online
- **THEN** the system downloads the model showing progress
- **AND** stores it in application data for reuse

