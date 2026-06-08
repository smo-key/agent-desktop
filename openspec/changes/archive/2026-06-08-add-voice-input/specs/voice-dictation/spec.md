## ADDED Requirements

### Requirement: Open and close the voice panel

The system SHALL provide a bottom-center voice panel that the user can open to
dictate. The panel SHALL be openable via an on-screen mic button (a small
footer-centered launcher) and via a solo tap of the right Command key (pressed
and released with no other key in between, so it never fires on a right-Command
shortcut). At most one voice panel SHALL be open at a time. The panel SHALL be
dismissable via the Escape key, a click outside the panel, and an explicit
stop/close control.

#### Scenario: Open via mic button

- **WHEN** the user clicks the footer voice mic button
- **THEN** the voice panel opens at bottom-center and recording begins

#### Scenario: Open via right Command tap

- **WHEN** the user taps the right Command key alone (press then release, no other key)
- **THEN** the voice panel opens at bottom-center and recording begins

#### Scenario: Right Command in a shortcut does not open the panel

- **WHEN** the user presses the right Command key together with another key (a shortcut)
- **THEN** the voice panel does not open

#### Scenario: Single panel instance

- **WHEN** the voice panel is already open
- **AND** the user triggers the open action again
- **THEN** the system does not open a second panel

#### Scenario: Dismiss the panel

- **WHEN** the voice panel is open
- **AND** the user presses Escape, clicks outside the panel, or activates the stop control
- **THEN** the panel closes and recording stops without inserting (discard)

#### Scenario: Right Command tap while recording finalizes

- **WHEN** the voice panel is open and recording
- **AND** the user taps the right Command key again
- **THEN** the system finalizes the dictation (final pass → polish per settings → insert) and closes the panel

#### Scenario: Escape cancels without inserting

- **WHEN** the voice panel is open and recording
- **AND** the user presses Escape
- **THEN** recording stops and nothing is inserted

### Requirement: Live transcript overlay

While recording, the system SHALL display a live mic-level waveform and the
in-progress transcript in the panel, alongside a confirm (insert) control. The
in-progress transcript MAY be revised as more audio context arrives. While the
final result is being produced (processing), the system SHALL show the captured
text with a distinct processing treatment until it is finalized. If no speech is
recognized, the system SHALL show a brief notice rather than closing silently.

#### Scenario: Waveform and partial text appear while speaking

- **WHEN** the user is speaking with the panel open
- **THEN** the panel shows a live waveform driven by the mic level
- **AND** shows the in-progress transcript, updating it as the user continues

#### Scenario: Processing treatment until finalized

- **WHEN** the user confirms and the final transcript is being produced
- **THEN** the panel shows the captured text with a distinct processing (shimmer) treatment until the result is finalized

#### Scenario: No speech recognized

- **WHEN** the user confirms but no speech was recognized (silence / too quiet / too short)
- **THEN** the panel shows a "didn't catch that" notice and does not close silently with no result

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

### Requirement: Verbatim insertion into the focused or selected agent terminal

When dictation completes, the system SHALL insert the finished text verbatim into
the target agent's terminal using the existing terminal send path. The target is
the focused agent pane when one is focused, otherwise the selected/first agent in
the active workspace. The system SHALL NOT append a trailing carriage return (no
auto-submit), and SHALL NOT wrap, synthesize, or otherwise alter the text into a
command. If there is NO existing agent, the system SHALL spin up a new agent
seeded with the dictated text rather than discarding it. Only when there is no
agent AND no project to start one in SHALL the system surface a clear "no target"
state.

#### Scenario: Insert into the focused/selected agent

- **WHEN** dictation finishes and an agent pane is focused or selected
- **THEN** the finished text is written verbatim into that agent's terminal without a trailing carriage return
- **AND** the user can review and press enter to submit

#### Scenario: No existing agent — spawn a new one

- **WHEN** dictation finishes and there is no existing agent terminal
- **AND** a project is available to launch into
- **THEN** the system spawns a new agent seeded with the dictated text

#### Scenario: No agent and no project

- **WHEN** dictation finishes, there is no agent, and no project to start one in
- **THEN** the panel shows a "no target" state and does not lose the text silently

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
- **THEN** the mic button and right-Command tap activation no longer open the panel
