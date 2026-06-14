## MODIFIED Requirements

### Requirement: A freshly launched coordinator reads Waiting, not Working

A LIVE project coordinator SHALL derive its status from three cases — Needs you, actively running, or idle — and SHALL NOT be shown as permanently In flight (working) while it is quiet. A coordinator that has NEVER started a turn (it spawned at an empty prompt and has had no `UserPromptSubmit`, whether typed by the user or injected by an escalation) SHALL read **Waiting** (Needs you), awaiting its first instruction. A coordinator that asks an AskUserQuestion or sets the `request_user_input` flag SHALL read **Waiting** regardless.

Otherwise — an ENGAGED coordinator (it has started at least one turn) with no pending question and no `request_user_input` flag — its status SHALL reflect its REAL activity, the same signals a non-coordinator pane uses:

- It SHALL read **Working** (In flight) while it is actually running: streaming output within the working window, or a terminal active-work affordance ("esc to interrupt" / "Waiting for N dynamic workflow(s)") observed within the busy grace window.
- It SHALL read **Idle** when it is genuinely quiet at its prompt (no recent output and no active-work affordance). An idle coordinator SHALL stay OUT of the Needs-you/attention lane (it never nags) and SHALL NOT be shown In flight — it SHALL show no in-flight status dot.

The "has started a turn" signal SHALL be latched durably (it survives eviction from the bounded activity ring), so a long single turn does not revert an engaged coordinator to the never-prompted Waiting case.

#### Scenario: Just-launched coordinator awaits the first instruction
- **WHEN** a coordinator has just been launched and has never been prompted (no turn has started)
- **THEN** it is shown as Waiting (Needs you), awaiting your first instruction

#### Scenario: Engaged but quiet coordinator reads Idle, out of attention
- **WHEN** a coordinator has started at least one turn and is now quiet — no recent output, no active-work affordance, no pending question, and no request_user_input flag
- **THEN** it is shown as Idle: out of attention (not Needs you) AND not In flight, so it shows no in-flight status dot

#### Scenario: Actively running coordinator reads Working
- **WHEN** an engaged coordinator with no pending question and no request_user_input flag is actively running — it is streaming output within the working window, or its terminal shows an active-work affordance within the busy grace window
- **THEN** it is shown as Working (In flight) with the in-flight dot

#### Scenario: A long-running coordinator stays Working after its prompt ages out
- **WHEN** an engaged coordinator runs a single long, actively-working turn whose events push the original `UserPromptSubmit` out of the bounded activity ring
- **THEN** it still reads Working — the "has started a turn" signal is latched DURABLY (it survives ring eviction) so it never reverts to the never-prompted Waiting case
