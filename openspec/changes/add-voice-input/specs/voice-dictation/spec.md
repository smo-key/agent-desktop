## ADDED Requirements

### Requirement: Open and close the voice panel

The system SHALL provide a bottom-center voice panel that the user can open to
dictate. The panel SHALL be openable via an on-screen mic button and via a
double-tap of the right Command key. At most one voice panel SHALL be open at a
time. The panel SHALL be dismissable via the Escape key, a click outside the
panel, and an explicit stop/close control.

#### Scenario: Open via mic button

- **WHEN** the user clicks the voice mic button
- **THEN** the voice panel opens at bottom-center and recording begins

#### Scenario: Open via double-tap right Command

- **WHEN** the user double-taps the right Command key within the double-tap window
- **THEN** the voice panel opens at bottom-center and recording begins

#### Scenario: Single panel instance

- **WHEN** the voice panel is already open
- **AND** the user triggers the open action again
- **THEN** the system does not open a second panel

#### Scenario: Dismiss the panel

- **WHEN** the voice panel is open
- **AND** the user presses Escape, clicks outside the panel, or activates the stop control
- **THEN** the panel closes and recording stops

### Requirement: Live transcript overlay

While recording, the system SHALL display the in-progress transcript in the
panel. Provisional (partial) text SHALL be visually distinct from committed text
and MAY be revised as more audio context arrives.

#### Scenario: Partial text appears while speaking

- **WHEN** the user is speaking with the panel open
- **THEN** the panel shows the in-progress transcript and updates it as the user continues

#### Scenario: Partial text is provisional

- **WHEN** new audio context revises an earlier partial guess
- **THEN** the displayed provisional text updates accordingly and remains visually distinct from committed text

### Requirement: Microphone permission handling

The system SHALL request microphone permission before capturing audio. If
permission is denied, the system SHALL display guidance directing the user to
grant access in macOS System Settings and SHALL NOT silently fail. Recording
SHALL NOT proceed until permission is granted.

#### Scenario: Permission granted

- **WHEN** the user opens the panel and grants microphone permission
- **THEN** recording begins

#### Scenario: Permission denied

- **WHEN** microphone permission is denied
- **THEN** the panel shows guidance to enable microphone access in System Settings
- **AND** no audio is captured

### Requirement: Verbatim insertion into the focused agent terminal

When dictation completes, the system SHALL insert the finished text verbatim into
the currently focused agent's terminal using the existing terminal send path. The
system SHALL NOT append a trailing carriage return (no auto-submit), and SHALL NOT
wrap, synthesize, or otherwise alter the text into a command. If no agent terminal
is focused, the system SHALL surface a clear "no target" state and SHALL NOT send
the text anywhere.

#### Scenario: Insert into focused terminal

- **WHEN** dictation finishes and an agent terminal is focused
- **THEN** the finished text is written verbatim into that terminal without a trailing carriage return
- **AND** the user can review and press enter to submit

#### Scenario: No focused agent terminal

- **WHEN** dictation finishes and no agent terminal is focused
- **THEN** the panel shows a "no target" state and does not send the text

### Requirement: Voice settings

The system SHALL provide a voice section in settings allowing the user to enable
or disable the feature, toggle the polish pass (default on), and select the model
tier. Settings SHALL persist across restarts using the existing settings storage.

#### Scenario: Toggle polish off

- **WHEN** the user turns the polish toggle off in settings
- **THEN** subsequent dictations insert the raw transcript without the polish pass
- **AND** the preference persists after restarting the app

#### Scenario: Disable the feature

- **WHEN** the user disables the voice feature in settings
- **THEN** the mic button and double-tap activation no longer open the panel
