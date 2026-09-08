## ADDED Requirements

### Requirement: Terminal rows derive status from the foreground job

A terminal row (combined placement) SHALL read **In flight** while a working process needs no action from the user — a running terminal-kind task, or a bare shell whose terminal is owned by a foreground job — and **Needs input** when the shell sits at an idle prompt. A terminal that exited with a non-zero code SHALL read as an error (Needs input); a stopped terminal (clean exit kept open, or stopped by the user) SHALL read finished. When the foreground state is unknown (platforms without the probe, or before the first probe), a running shell SHALL fall back to the output-activity derivation used for agents.

#### Scenario: A running task terminal reads In flight
- **WHEN** a terminal-kind task is running
- **THEN** its row status is `working`

#### Scenario: A shell running a foreground job reads In flight
- **WHEN** a bare shell is running and the probe reports a foreground job
- **THEN** its row status is `working`

#### Scenario: An idle shell prompt reads Needs input
- **WHEN** a bare shell is running and the probe reports no foreground job
- **THEN** its row status is `waiting`

#### Scenario: A failed terminal reads Needs input as an error
- **WHEN** a terminal stopped with a non-zero exit code
- **THEN** its row status is `error`

#### Scenario: A stopped terminal reads finished
- **WHEN** a terminal stopped with exit code 0 or was stopped by the user
- **THEN** its row status is `finished`

#### Scenario: Unknown foreground state falls back to output activity
- **WHEN** a bare shell is running and no probe result is known
- **THEN** its status follows the output-activity derivation (recent output → `working`, quiet → `waiting`)
