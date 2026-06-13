# agent-status-derivation Specification

## Purpose
TBD - created by archiving change agent-session-ux-improvements. Update Purpose after archive.
## Requirements
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

#### Scenario: A long-running coordinator stays Working after its prompt ages out
- **WHEN** a coordinator has started its first turn and then runs a single long turn whose events push the original `UserPromptSubmit` out of the bounded activity ring
- **THEN** it still reads Working — the "has started a turn" signal is latched DURABLY (it survives ring eviction) rather than recomputed from the ring contents — not Waiting

### Requirement: A working parent stays In flight while a Task subagent finishes

A LIVE agent SHALL continue to read **In flight** (working) when an in-process Task
subagent it spawned finishes (a `SubagentStop` event), because the parent's `Task`
tool has not returned and the parent is still mid-turn. A `SubagentStop` event SHALL
NOT, on its own, move the agent to **Needs input** (`waiting`) and SHALL NOT clear the
agent's in-flight tool. Only the agent's OWN turn end (a `Stop` event) returns it to
the awaiting-you state. This holds when several subagents run in parallel: each
subagent's `SubagentStop` leaves the parent In flight while its siblings (and the
parent `Task`) are still running.

A `SubagentStop` SHALL still count as evidence the session has begun a turn (a subagent
can only run after a prompt), so the freshly-launched-coordinator "never prompted"
heuristic does not regress.

#### Scenario: Subagent finishes while the parent Task is in flight
- **WHEN** an agent has a `Task` tool in flight (a `PreToolUse[Task]` with no matching `PostToolUse`) and a `SubagentStop` event arrives for the finished subagent
- **THEN** the agent is shown In flight (working), not Needs input

#### Scenario: One of several parallel subagents finishes
- **WHEN** an agent ran multiple subagents in parallel and one of them emits `SubagentStop` while the others are still running
- **THEN** the agent remains In flight (working), not Needs input

#### Scenario: The parent's own turn end still reads Needs input
- **WHEN** a subagent has finished (`SubagentStop`) and the agent later ends its own turn (a `Stop` event with no tool in flight)
- **THEN** the agent is shown Needs input (waiting), awaiting you

#### Scenario: A subagent run proves the session was prompted
- **WHEN** a session's observed events include a `SubagentStop` (a subagent ran) but the original `UserPromptSubmit` is no longer present
- **THEN** the session is still treated as having begun a turn (everPrompted), so a coordinator is not wrongly reverted to the never-prompted Waiting state

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

### Requirement: A resize/redraw does not read as work-activity

PTY output that is the direct result of a self-initiated terminal resize SHALL NOT count as work-activity for status derivation. When the app resizes a pane's terminal (e.g. the pane becomes visible after its workspace is selected, pushing a `pty_resize` that makes Claude's TUI redraw via SIGWINCH), the resulting redraw output SHALL NOT, on its own, promote an otherwise-idle agent to In flight. Output that arrives within a short window after a self-initiated resize, while the pane is otherwise idle (already quiet past the working window), SHALL be ignored for the work-activity (silence) signal; output outside that window, and output from a pane that is not otherwise idle, SHALL be tracked as normal. This is additive and fail-safe: with no recent self-initiated resize, activity tracking is exactly as before, and a genuinely working agent (recent real output, an event-sourced working status, or an active-work affordance) is never suppressed and so cannot be demoted by any number of resizes.

#### Scenario: Selecting an idle agent does not read it as In flight

- **WHEN** an idle agent (quiet past the working window, no event-sourced working status, no active-work affordance) is selected, so its pane becomes visible and a resize makes the terminal redraw
- **THEN** the redraw output does not promote it to In flight; it stays Needs input

#### Scenario: Real output after the resize window still reads as working

- **WHEN** terminal output arrives outside the short post-resize window (genuine work, not a redraw)
- **THEN** it is tracked as work-activity and the agent reads In flight as before

#### Scenario: A working agent is never suppressed by resizes

- **WHEN** a genuinely working agent (recent output) is resized one or more times
- **THEN** its output continues to be tracked as work-activity and it stays In flight, regardless of how many resizes occur

#### Scenario: No recent resize leaves activity tracking unchanged

- **WHEN** output arrives with no self-initiated resize having occurred in the preceding window
- **THEN** the activity stamp is recorded exactly as before this change (fail-safe)

