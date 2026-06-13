# agent-status-derivation Specification (delta)

## MODIFIED Requirements

### Requirement: A busy session reads In flight, not Needs input

An agent SHALL be shown as **In flight** (working) rather than **Needs input** when Claude Code is actively working in a session but its event hooks report idle — until the work finishes (plus a short grace window, below) or the user interrupts it. This SHALL cover at least: (a) a foreground command running in the agent's terminal (the "Running…" / "esc to interrupt" / "ctrl+b to run in background" state, e.g. from a `! <cmd>` bash-mode run); and (b) in-session background work — a dynamic workflow or another agent still running within the session (the "Waiting for N dynamic workflow(s) to finish" state) after the main agent's turn has returned.

The active-work indicator is sampled from the live terminal on a periodic clock, and the affordance is part of a continuously-redrawing TUI, so a single sample can momentarily miss an affordance that is still present. To keep the status from flickering between In flight and Needs input, the override SHALL be **held for a short grace window after the affordance was last detected**: once an active-work affordance has been observed, the agent SHALL continue to read In flight until the grace window elapses with no further observation of the affordance. A fresh observation SHALL re-arm the window immediately (promotion stays responsive); the override SHALL lapse only after the affordance has been continuously absent for the whole grace window.

The override SHALL NOT apply when the agent has a pending AskUserQuestion (such an agent still reads Needs input), and SHALL NOT change coordinator status derivation. When no active-work indicator has ever been observed (or the grace window has lapsed), status derivation SHALL be exactly as before (fail-safe).

#### Scenario: Foreground command keeps the agent In flight
- **WHEN** a foreground command is running in the agent's terminal (the terminal shows the "esc to interrupt" / "ctrl+b to run in background" running affordance)
- **THEN** the agent is shown as In flight, not Needs input

#### Scenario: A momentary missed detection does not bounce the agent
- **WHEN** a live non-coordinator agent is In flight from the active-work override and a single periodic sample fails to observe the affordance (e.g. the spinner line is mid-redraw) while the work is still ongoing, then the affordance is observed again within the grace window
- **THEN** the agent stays In flight across that sample rather than bouncing to Needs input and back

#### Scenario: Status returns to normal a grace window after the command ends
- **WHEN** the foreground command finishes or the user interrupts it (Ctrl-C / Esc) and the running affordance disappears, and the grace window then elapses with no further affordance
- **THEN** the agent returns to its normally-derived status (e.g. Needs input at an idle prompt)

#### Scenario: In-session background workflow keeps the agent In flight
- **WHEN** the main agent's turn has returned but a dynamic workflow or another agent is still running in the session (the terminal shows "Waiting for N dynamic workflow(s) to finish")
- **THEN** the agent is shown as In flight, not Needs input

#### Scenario: A pending question still reads Needs input
- **WHEN** an agent has a pending AskUserQuestion
- **THEN** it is shown as Needs input regardless of any active-work indicator, even within the grace window

#### Scenario: No indicator means unchanged behavior
- **WHEN** no active-work indicator has ever been observed for the agent (or the grace window has lapsed since the last observation)
- **THEN** the agent's status is derived exactly as it was before this change
