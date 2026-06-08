## MODIFIED Requirements

### Requirement: Open and close the voice panel

The system SHALL provide a bottom-center voice panel that the user can open to
dictate. The panel SHALL be openable via an on-screen mic button (a small
footer-centered launcher) and via a solo tap of the right Command key (pressed
and released with no other key in between, so it never fires on a right-Command
shortcut). At most one voice panel SHALL be open at a time. The panel SHALL be
dismissable via the Escape key and an explicit stop/close control. The panel is
a non-modal floating overlay: clicking outside it SHALL NOT close or cancel the
panel, and the application behind SHALL remain interactive while the panel is
open (no click-catching scrim). While the panel is open, the Escape key SHALL
cancel it even when a terminal/TUI is focused — the panel SHALL intercept Escape
before the focused terminal receives it, so a single Escape always cancels
dictation rather than reaching the underlying app.

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
- **AND** the user presses Escape or activates the stop control
- **THEN** the panel closes and recording stops without inserting (discard)

#### Scenario: Clicking outside the panel does not close it

- **WHEN** the voice panel is open
- **AND** the user clicks outside the panel (in the app behind it)
- **THEN** the panel stays open, recording continues, nothing is discarded
- **AND** the click reaches the application behind (the panel does not block it)

#### Scenario: Right Command tap while recording finalizes

- **WHEN** the voice panel is open and recording
- **AND** the user taps the right Command key again
- **THEN** the system finalizes the dictation (final pass → polish per settings → insert) and closes the panel

#### Scenario: Escape cancels without inserting

- **WHEN** the voice panel is open and recording
- **AND** the user presses Escape
- **THEN** recording stops and nothing is inserted

#### Scenario: Escape cancels even when a terminal is focused

- **WHEN** the voice panel is open while a terminal/TUI pane is focused
- **AND** the user presses Escape
- **THEN** the voice panel cancels (discards) and the focused terminal does NOT receive the Escape
