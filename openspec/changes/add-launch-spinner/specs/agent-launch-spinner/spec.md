## ADDED Requirements

### Requirement: Agent panes show a launch spinner

While an agent pane (`claude`) is coming up — from PTY spawn until the agent is ready — the app SHALL overlay the pane with a centered spinner and a status label. The overlay SHALL cover the pane background so a blank or half-rendered TUI is not visible underneath, and SHALL be purely visual (it never intercepts pointer input). Non-agent (shell) panes SHALL NOT show the overlay.

#### Scenario: Agent pane shows a launch spinner while starting

- **WHEN** a `claude` agent pane is created
- **THEN** the launch spinner overlay is shown until the agent is ready

#### Scenario: Shell pane shows no launch spinner

- **WHEN** a non-agent (shell) pane is created
- **THEN** no launch spinner overlay is shown

### Requirement: The spinner clears when the agent is ready

The launch spinner SHALL clear once the agent is ready, determined by whether the pane carries an initial prompt:

- A pane WITHOUT an initial prompt (a plain new session, or a pane resumed from a prior transcript) SHALL clear the spinner on the first PTY output (the TUI has begun rendering).
- A pane WITH an initial prompt SHALL keep the spinner through the startup output burst and clear it only when the prompt is injected, so the empty input box is never shown before the prompt lands.
- An agent that exits before becoming ready SHALL clear the spinner, so a process that dies on launch does not spin forever.

#### Scenario: Promptless agent clears the spinner on first output

- **WHEN** a promptless agent pane emits its first PTY output
- **THEN** the launch spinner clears

#### Scenario: Resumed agent clears the spinner on first output

- **WHEN** a resumed agent pane (no initial prompt) emits its first PTY output
- **THEN** the launch spinner clears

#### Scenario: Prompt-bearing agent holds the spinner until the prompt is injected

- **WHEN** an agent pane carrying an initial prompt emits startup output
- **THEN** the launch spinner stays shown until the prompt is injected, at which point it clears

#### Scenario: Spinner clears if the agent exits before becoming ready

- **WHEN** an agent pane's process exits before it becomes ready
- **THEN** the launch spinner clears

### Requirement: The spinner label reflects fresh launch vs resume

The label SHALL be "Resuming…" when the pane is restored from a prior session (`--resume`), and "Starting…" otherwise (a fresh launch or split, including when the resume flag is absent).

#### Scenario: Resuming label for a resumed pane

- **WHEN** the pane is a resumed session
- **THEN** the label reads "Resuming…"

#### Scenario: Starting label for a fresh launch

- **WHEN** the pane is a fresh launch (resume flag false or absent)
- **THEN** the label reads "Starting…"
