## ADDED Requirements

### Requirement: Silence alone does not bounce a working agent to Needs input

A live, non-coordinator agent already shown as **In flight** (working) SHALL NOT be moved to **Needs input** by a brief stretch of terminal silence; demotion on silence alone SHALL require a longer confirmed-idle window than promotion does (hysteresis). When the status is derived from the terminal-silence fallback (no event-sourced status), promotion to In flight SHALL stay responsive (terminal output within the existing short working window), but an agent that was previously In flight SHALL hold In flight through continued silence until an idle-grace window has elapsed, only then reading Needs input. Any new terminal output SHALL reset the silence measurement, so re-promotion to In flight is immediate.

This SHALL apply to all live, non-coordinator panes whose status falls through to the silence-based heuristic — both sessions with no event pipeline and event-pipeline sessions in a transient gap where no event-sourced status is available (e.g. just after a `SubagentStop`). It SHALL NOT change coordinator status derivation.

Hysteresis SHALL govern only the silence-driven In flight → Needs input transition. A positive waiting signal SHALL still resolve immediately and is NOT held by the idle-grace window: an event-sourced `waiting` or `finished` status, a pending `AskUserQuestion`, and a process exit SHALL take effect on the tick they are observed. A pane that was already Needs input (not In flight) SHALL NOT be promoted to In flight by the hysteresis hold — only fresh output promotes it.

When no previous status has been recorded for a pane (its first derivation, or a freshly created pane), derivation SHALL fall back to the single-window behavior exactly as before this change (fail-safe).

#### Scenario: A brief silence keeps a working agent In flight
- **WHEN** a live non-coordinator agent is shown In flight (working) from the silence-based heuristic and its terminal then goes quiet for longer than the short working window but less than the idle-grace window
- **THEN** the agent stays In flight rather than bouncing to Needs input

#### Scenario: Confirmed idle eventually reads Needs input
- **WHEN** that agent's terminal stays quiet continuously past the idle-grace window with no event-sourced status, pending question, or exit
- **THEN** the agent reads Needs input (waiting)

#### Scenario: New output re-promotes immediately
- **WHEN** a working agent has been quiet within the idle-grace band and then produces any terminal output
- **THEN** the silence measurement resets and the agent is In flight again on the next derivation, without waiting out the grace window

#### Scenario: A settled idle agent is not re-promoted by the hold
- **WHEN** a pane was already Needs input (not In flight) and remains quiet
- **THEN** the hysteresis hold does not apply and it stays Needs input until fresh terminal output arrives

#### Scenario: A positive waiting signal demotes immediately
- **WHEN** a live non-coordinator agent shown In flight gains a positive waiting signal — an event-sourced `waiting`/`finished`, a pending `AskUserQuestion`, or a process exit
- **THEN** it reads Needs input (or finished/error) on that tick, without being held by the idle-grace window

#### Scenario: No recorded prior status falls back to prior behavior
- **WHEN** a pane has no previously-recorded derived status (first derivation or a freshly created pane)
- **THEN** its status is derived with the single short working window exactly as before this change
