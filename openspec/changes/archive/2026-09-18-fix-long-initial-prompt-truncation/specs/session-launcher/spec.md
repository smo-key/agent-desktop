## MODIFIED Requirements

### Requirement: Optional Initial Prompt

The system SHALL let the user optionally enter an initial prompt that is delivered to the spawned `claude` session, and SHALL spawn the session normally when no prompt is provided.

#### Scenario: Launch with an initial prompt

- **WHEN** the user enters a non-empty initial prompt and confirms the launch
- **THEN** the spawned `claude` session receives that prompt as its first user input (e.g. written to the PTY after spawn) so it appears as the opening message of the session

#### Scenario: Launch with no initial prompt

- **WHEN** the user confirms the launch leaving the initial-prompt field empty
- **THEN** the session is spawned and `claude` starts at an idle interactive prompt awaiting user input, with no synthetic input injected

#### Scenario: Initial prompt is delivered only after the TUI is ready

- **WHEN** a session is launched with a non-empty initial prompt
- **THEN** the prompt is NOT written until the spawned `claude` has emitted its first PTY output and that output has then settled (the TUI is rendered and accepting input), so the prompt is never written into a terminal that has not started rendering
- **AND** a slow startup that stays silent past the settle window (e.g. a coordinated agent loading the orchestration toolkit) does NOT cause early delivery — the settle window only begins after the first output byte
- **AND** if output never settles, a hard-cap backstop delivers the prompt anyway so it never hangs

#### Scenario: A long initial prompt is delivered whole

- **WHEN** a session is launched into an agent pane with an initial prompt longer than the tty's input chunk size (e.g. a 1.4 KB agent-task prompt)
- **THEN** the prompt text is written to the PTY wrapped in bracketed-paste markers (`ESC[200~` … `ESC[201~`), with any embedded paste-end marker stripped, so the agent receives the ENTIRE prompt as its opening message rather than only its tail
- **AND** the submitting Enter is still delivered as a separate, later write

#### Scenario: Shell pane initial command is written raw

- **WHEN** a non-agent (shell) pane is launched with an initial command
- **THEN** the command is written verbatim with no bracketed-paste markers
