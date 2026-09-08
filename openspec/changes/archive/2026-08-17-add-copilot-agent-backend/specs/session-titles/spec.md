## ADDED Requirements

### Requirement: Auto-titles for Copilot sessions
On-device auto-title generation SHALL run for Copilot sessions using user
message text sourced from the Copilot session event log, under the same
constraints, caching, and refresh triggers as Claude sessions. The opt-in
cloud title fallback (`claude -p`) SHALL apply to Copilot sessions' text the
same way it applies to Claude sessions' — it is a fallback title generator,
not a property of the session's backend — and remains OFF by default.

#### Scenario: Copilot session gets an on-device title
- **WHEN** a Copilot session records its first user message in its event log
- **THEN** on-device title generation produces a ≤6-word title for the pane, cached and refreshed per the existing title rules

#### Scenario: Manual rename still wins
- **WHEN** the user renames a Copilot session
- **THEN** auto-titling stops overwriting it, matching Claude-session rename behavior
