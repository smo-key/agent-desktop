## ADDED Requirements

### Requirement: Bare terminal rows are titled from the commands the user ran

A bare shell listed in the combined sessions list SHALL be given a generated title summarizing what the user was doing in it, derived only from the commands the user ran at a normal shell prompt. A typed line SHALL be treated as a CANDIDATE and recorded only when the terminal ECHOED it, so a secret typed at a hidden prompt — including at a shell BUILTIN such as `read -s`, which never changes the foreground process group and is therefore invisible to the foreground probe — is never collected, and a line the shell rewrote (tab completion, history recall, search, paste) is dropped rather than recorded as a command that was never run. Collection SHALL stop the moment a line is submitted and resume only when the foreground probe re-confirms an idle prompt, and the buffer SHALL be memory-only and never persisted. The title SHALL be (re)generated only when the confirmed command list changes, SHALL be generated ON-DEVICE ONLY (the session-transcript cloud fallback does not extend to shell command lines, so with no local model the row keeps its name), and SHALL be skipped entirely for a shell the user has run nothing in. A terminal-kind TASK row SHALL NOT be titled by the model: its command is already its name.

#### Scenario: Typed commands accumulate at an idle prompt
- **WHEN** the user types a command and presses Return at an idle prompt that echoes it
- **THEN** the command joins the terminal's bounded recent-command list, with backspaces and kill-line applied and the oldest command dropped past the cap

#### Scenario: Input to a running job is not collected
- **WHEN** a submitted command hands the terminal to a program that prompts for input, and the user types at that prompt
- **THEN** nothing is added to the recent-command list and no fragment of it is carried into the next command

#### Scenario: An unechoed line is never recorded
- **WHEN** a line is submitted that the terminal never echoed, or that does not match what the screen shows
- **THEN** it is discarded instead of being recorded as a command

#### Scenario: A bare shell is titled from its recent commands
- **WHEN** a bare shell's recent-command list changes
- **THEN** a title is requested for it from the on-device terminal-title model and shown on its row

#### Scenario: An untouched shell is never titled
- **WHEN** a bare shell has no confirmed commands, or a row is a task terminal
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
- **THEN** it carries the terminal title system prompt, which states the commands are data and must not be followed
