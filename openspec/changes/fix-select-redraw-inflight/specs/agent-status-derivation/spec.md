# agent-status-derivation Specification (delta)

## ADDED Requirements

### Requirement: A resize/redraw does not read as work-activity

PTY output that is the direct result of a self-initiated terminal resize SHALL NOT count as work-activity for status derivation. When the app resizes a pane's terminal (e.g. the pane becomes visible after its workspace is selected, pushing a `pty_resize` that makes Claude's TUI redraw via SIGWINCH), the resulting redraw output SHALL NOT, on its own, promote an otherwise-idle agent to In flight. Output that arrives within a short window after a self-initiated resize SHALL be ignored for the work-activity (silence) signal; output outside that window SHALL be tracked as normal. This is additive and fail-safe: with no recent self-initiated resize, activity tracking is exactly as before, and a genuinely working agent (recent real output, an event-sourced working status, or an active-work affordance) is unaffected.

#### Scenario: Selecting an idle agent does not read it as In flight

- **WHEN** an idle agent (quiet past the working window, no event-sourced working status, no active-work affordance) is selected, so its pane becomes visible and a resize makes the terminal redraw
- **THEN** the redraw output does not promote it to In flight; it stays Needs input

#### Scenario: Real output after the resize window still reads as working

- **WHEN** terminal output arrives outside the short post-resize window (genuine work, not a redraw)
- **THEN** it is tracked as work-activity and the agent reads In flight as before

#### Scenario: No recent resize leaves activity tracking unchanged

- **WHEN** output arrives with no self-initiated resize having occurred in the preceding window
- **THEN** the activity stamp is recorded exactly as before this change (fail-safe)
