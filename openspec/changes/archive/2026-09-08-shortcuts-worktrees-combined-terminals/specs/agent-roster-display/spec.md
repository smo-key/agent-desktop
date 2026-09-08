## MODIFIED Requirements

### Requirement: The agent card shows the model, not the cost

An agent card SHALL display the agent's git WORKTREE name on its meta line, left of the time since last activity, when the session is running inside a linked git worktree (from the latest snapshot's `git.worktree`), and SHALL omit that slot otherwise. The card SHALL NOT show the model label (it remains in the footer) and SHALL NOT show the per-agent dollar amount (cost remains tracked and surfaced in the aggregate total).

#### Scenario: Card shows the worktree name
- **WHEN** an agent card renders for an agent whose latest snapshot reports worktree `feature-x`
- **THEN** the card's meta line shows `feature-x` left of the time since last activity

#### Scenario: Card omits the worktree slot outside a worktree
- **WHEN** an agent card renders for an agent whose snapshot reports no worktree
- **THEN** the meta line shows no worktree entry (just context and time)

#### Scenario: No per-agent cost or model on the card
- **WHEN** an agent card renders
- **THEN** neither a dollar cost nor a model label is shown on the card

### Requirement: Compact mode hides the roster row's meta line

The sessions panel SHALL offer a density preference, exposed in Settings as a
"Default" / "Compact" / "Minimal" dropdown shown as the FIRST setting, and
persisted across restarts. The preference SHALL default to "Default". WHEN
"Compact" is selected, every roster row SHALL omit its third content line — the
meta line carrying the context-window measure, the worktree name, and the time
since last activity — leaving the title and status sub-line. WHEN "Minimal" is
selected, every roster row SHALL keep only its title beside a smaller project
icon, omitting both the status sub-line and the meta line. WHEN "Default" is
selected (the default), rows SHALL render all three lines as before. A legacy
persisted `{ enabled: true }` compact-mode slice SHALL be read as "Compact".

#### Scenario: Compact mode hides the meta line

- **WHEN** a roster row renders while compact mode is enabled
- **THEN** the row shows its title and status sub-line but not the
  context/worktree/time meta line
