## ADDED Requirements

### Requirement: A busy session reads In flight, not Needs input

An agent SHALL be shown as **In flight** (working) rather than **Needs input** when
Claude Code is actively working in a session but its event hooks report idle —
until the work finishes or the user interrupts it. This SHALL cover at least:
(a) a foreground command running in the agent's terminal (the "Running…" /
"esc to interrupt" / "ctrl+b to run in background" state, e.g. from a `! <cmd>`
bash-mode run); and (b) in-session background work — a dynamic workflow or another
agent still running within the session (the "Waiting for N dynamic workflow(s) to
finish" state) after the main agent's turn has returned.

The override SHALL NOT apply when the agent has a pending AskUserQuestion (such an
agent still reads Needs input), and SHALL NOT change coordinator status derivation.
When no active-work indicator is present, status derivation SHALL be exactly as
before (fail-safe).

#### Scenario: Foreground command keeps the agent In flight
- **WHEN** a foreground command is running in the agent's terminal (the terminal shows the "esc to interrupt" / "ctrl+b to run in background" running affordance)
- **THEN** the agent is shown as In flight, not Needs input

#### Scenario: Status returns to normal when the command ends or is interrupted
- **WHEN** the foreground command finishes or the user interrupts it (Ctrl-C / Esc) and the running affordance disappears
- **THEN** the agent returns to its normally-derived status (e.g. Needs input at an idle prompt)

#### Scenario: In-session background workflow keeps the agent In flight
- **WHEN** the main agent's turn has returned but a dynamic workflow or another agent is still running in the session (the terminal shows "Waiting for N dynamic workflow(s) to finish")
- **THEN** the agent is shown as In flight, not Needs input

#### Scenario: A pending question still reads Needs input
- **WHEN** an agent has a pending AskUserQuestion
- **THEN** it is shown as Needs input regardless of any active-work indicator

#### Scenario: No indicator means unchanged behavior
- **WHEN** no active-work indicator is present in the terminal
- **THEN** the agent's status is derived exactly as it was before this change

### Requirement: A freshly launched coordinator reads Waiting, not Working

A LIVE project coordinator that has NEVER started a turn SHALL be shown as **Waiting**
(Needs you): it spawned at an empty prompt and has not yet been prompted (no
`UserPromptSubmit`, whether typed by the user or injected by an escalation), so it is
idle awaiting its first instruction. This is an EXCEPTION to the coordinator's
quiet-stays-Working suppression: ONCE the coordinator has started its first turn, a
quiet/between-turns coordinator with no pending question and no `request_user_input`
flag SHALL continue to read **Working** (out of attention) as before. A coordinator
that asks an AskUserQuestion or sets the `request_user_input` flag SHALL read Waiting
regardless.

#### Scenario: Just-launched coordinator awaits the first instruction
- **WHEN** a coordinator has just been launched and has never been prompted (no turn has started)
- **THEN** it is shown as Waiting (Needs you), awaiting your first instruction

#### Scenario: Engaged but quiet coordinator stays Working
- **WHEN** a coordinator has started at least one turn and is now quiet, with no pending question and no request_user_input flag
- **THEN** it is shown as Working (out of attention), not Waiting
