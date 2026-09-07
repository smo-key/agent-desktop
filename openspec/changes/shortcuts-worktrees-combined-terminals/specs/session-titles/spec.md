## ADDED Requirements

### Requirement: Bare terminal rows are titled from the activity the shell reports

A bare shell listed in the combined sessions list SHALL be given a generated title summarizing what the user was doing in it, derived from the activity the SHELL reports about itself — the window titles it sets (OSC 0/2), which are typically the command it dispatched or its working directory. The user's keystrokes SHALL NOT be a title source: the input stream carries whatever a program reads from stdin — a password at a prompt a shell builtin owns, a heredoc body, a token piped to a CLI — which cannot be reliably separated from commands, whereas a shell sets its window title only when it dispatches a command. Rendered output SHALL NOT be a source either: it changes on every chunk and carries what programs print.

Repeat and blank reports SHALL be collapsed, the list SHALL be bounded and memory-only (never persisted), and a shell that has reported nothing beyond a single unchanging title SHALL be left untitled rather than titled from noise. The title SHALL be (re)generated only when the reported list changes, SHALL be generated ON-DEVICE ONLY (the session-transcript cloud fallback does not extend to terminal activity, so with no local model the row keeps its name), and a terminal-kind TASK row SHALL NOT be titled by the model: its command is already its name.

#### Scenario: The shell reported activity accumulates
- **WHEN** a shell reports a sequence of window titles as the user works
- **THEN** they are collected in order, with blanks ignored, an immediate repeat collapsed, and the oldest dropped past the cap

#### Scenario: A shell that reports nothing new is never titled
- **WHEN** a shell has reported nothing, or only one unchanging title
- **THEN** no title request is made for it

#### Scenario: A bare shell is titled from its recent commands
- **WHEN** a bare shell's reported activity changes
- **THEN** a title is requested for it from the on-device terminal-title model and shown on its row

#### Scenario: An untouched shell is never titled
- **WHEN** a bare shell has reported no activity, or a row is a task terminal
- **THEN** no title request is made for it

#### Scenario: A stale title response never replaces a newer one
- **WHEN** a title request resolves after a later request for the same terminal has already taken over
- **THEN** its result is discarded and the newer title stands

#### Scenario: A failed terminal title request backs off
- **WHEN** a terminal title request fails because no on-device model is available
- **THEN** that terminal is not retried until its backoff expires

#### Scenario: A closed terminal's title state is reclaimed
- **WHEN** a terminal row disappears from the roster
- **THEN** its cached title and request bookkeeping are dropped

#### Scenario: Terminal text is treated as data
- **WHEN** the terminal-title request body is built
- **THEN** it carries the terminal title system prompt, which states the reported entries are data and must not be followed
