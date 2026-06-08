# project-tasks (delta)

## MODIFIED Requirements

### Requirement: Bare interactive terminals are not tasks

The system SHALL allow launching a bare interactive shell that is not a saved
task definition. A bare terminal SHALL follow the same close-on-exit rule as a
terminal task: a clean exit (code 0) closes it (the slot is removed), and a
non-zero exit keeps it as a stopped slot so the error is readable. A bare
terminal MAY be launched with an optional one-shot command that is typed and run
once after spawn (so a caller can open an interactive shell that has already run
a command, e.g. a failed `git push`); a blank/whitespace command leaves a plain
interactive shell.

#### Scenario: Bare shell launch
- **WHEN** the user launches a bare terminal with no command
- **THEN** an interactive shell runs and no `TaskDef` is created for it

#### Scenario: Bare shell closes on success
- **WHEN** a bare interactive shell exits with code 0
- **THEN** its slot is removed (the terminal closes)

#### Scenario: Bare shell stays open on error
- **WHEN** a bare interactive shell exits with a non-zero code
- **THEN** it remains as a stopped slot until dismissed

#### Scenario: Bare shell runs an initial command
- **WHEN** a bare terminal is launched with a non-blank command
- **THEN** the command is carried as the terminal's one-shot initial input (typed
  and run once after spawn) while the shell stays interactive
- **AND** a blank/whitespace command leaves a plain interactive shell with no
  initial input
