# transcript-polish Specification

## Purpose
TBD - created by syncing change add-voice-input. Update Purpose after archive.
## Requirements
### Requirement: On-device transcript polishing

When the polish setting is enabled, the system SHALL pass the final transcript
through a local LLM that removes filler words, false starts, and repetitions, and
fixes punctuation and capitalization to produce clean, agent-ready text. The
polish pass SHALL run entirely on-device and SHALL NOT add new content beyond what
was spoken.

#### Scenario: Fillers and false starts removed

- **WHEN** polishing is enabled and the final transcript contains fillers (e.g. "um", "uh"), false starts, or repetitions
- **THEN** the inserted text has them removed and is punctuated and capitalized
- **AND** no audio or transcript leaves the device

#### Scenario: No content added

- **WHEN** the polish pass runs
- **THEN** the output conveys only what was spoken and does not introduce new facts or instructions

### Requirement: Bypass polishing when disabled

When the polish setting is disabled, the system SHALL insert the raw final
transcript without invoking the polish LLM.

#### Scenario: Raw transcript when polish off

- **WHEN** polishing is disabled
- **THEN** the system inserts the raw final transcript and does not run the polish LLM

### Requirement: Graceful degradation

If the polish LLM is unavailable or fails, the system SHALL fall back to inserting
the raw final transcript rather than blocking insertion or losing the dictation.

#### Scenario: Polish model unavailable

- **WHEN** polishing is enabled but the polish LLM cannot be loaded or fails
- **THEN** the system inserts the raw final transcript
- **AND** does not block the user from receiving their dictated text
