## ADDED Requirements

### Requirement: Foreground Job Query

The PTY manager SHALL answer whether a live pane's terminal is currently owned by a foreground job: on Unix, the terminal's foreground process group differs from the pane's direct child (the shell), meaning a job it launched holds the terminal; when the platform cannot answer (Windows, or no child pid) the result is unknown (`null`) rather than a guess. An unknown pane id SHALL be an error. The query is exposed to the frontend as the `pty_foreground_busy` command.

#### Scenario: Idle shell reports no foreground job
- **WHEN** an interactive shell pane sits at its prompt
- **THEN** the query answers `false`

#### Scenario: Running foreground command reports a job
- **WHEN** an interactive shell pane is running a foreground command such as `sleep`
- **THEN** the query answers `true`

#### Scenario: Unknown pane yields an error
- **WHEN** the query names a pane id that does not exist
- **THEN** it returns an error
