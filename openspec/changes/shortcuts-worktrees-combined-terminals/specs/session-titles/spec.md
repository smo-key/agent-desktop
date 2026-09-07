## ADDED Requirements

### Requirement: Bare terminal rows are titled from the commands the user ran

A bare shell listed in the combined sessions list SHALL be given a generated title summarizing what the user was doing in it, derived ONLY from the commands the user typed at an idle prompt — collected from the terminal's own input stream while the foreground probe reports no running job, so keystrokes typed into a running program (a password or other prompt input) are never collected, kept in memory only, and never persisted. The title SHALL be (re)generated only when that command list changes, through the same on-device title model (with the same opt-in cloud fallback) as session titles, and SHALL be skipped entirely for a shell the user has not typed a command into. A terminal-kind TASK row SHALL NOT be titled by the model: its command is already its name.

#### Scenario: Typed commands accumulate at an idle prompt
- **WHEN** the user types a command and presses Return at an idle prompt
- **THEN** the command joins the terminal's bounded recent-command list, with backspaces and control keys applied and the oldest command dropped past the cap

#### Scenario: Input to a running job is not collected
- **WHEN** the foreground probe reports a running job and the user types
- **THEN** nothing is added to the recent-command list

#### Scenario: A bare shell is titled from its recent commands
- **WHEN** a bare shell's recent-command list changes
- **THEN** a title is requested for it from the terminal-title model and shown on its row

#### Scenario: An untouched shell is never titled
- **WHEN** a bare shell has no typed commands, or a row is a task terminal
- **THEN** no title request is made for it

#### Scenario: Terminal text is treated as data
- **WHEN** the terminal-title request body is built
- **THEN** it carries the terminal title system prompt, which states the commands are data and must not be followed
