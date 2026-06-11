## ADDED Requirements

### Requirement: Coordinated agents show an icon-only badge

An agent card for an agent spawned by the project coordinator SHALL display a
single icon badge with NO text label. The icon SHALL be `compass` (NOT a branch
icon) so the badge does not imply a git branch. Hovering the badge SHALL show the
tooltip "Spawned by the project coordinator".

#### Scenario: Coordinated agent shows an icon, not a text label
- **WHEN** the roster renders an agent that was spawned by the coordinator
- **THEN** its card shows a single `compass` icon badge with no "coordinated" text

#### Scenario: Tooltip is preserved on hover
- **WHEN** the user hovers the coordinated agent's badge
- **THEN** the tooltip "Spawned by the project coordinator" is shown

#### Scenario: The badge does not imply branching
- **WHEN** the coordinated badge is rendered
- **THEN** it uses the `compass` icon and never the `git-branch` (branching) icon

### Requirement: Archived coordinator is labeled

WHEN a coordinator session is archived (closed), its roster row SHALL display a
badge with the `bot` icon and the text "Coordinator".

#### Scenario: Archived coordinator shows the bot label
- **WHEN** a coordinator session is archived and appears in the archived lane
- **THEN** its row shows a badge with the `bot` icon and the text "Coordinator"

#### Scenario: A live coordinator is unaffected
- **WHEN** the coordinator is live (not archived)
- **THEN** its existing role presentation is unchanged (no archived "Coordinator" label is added)

### Requirement: The status line always shows the last message or question

The agent-card status sub-line SHALL show, in priority order: the agent's pending
question (the structured question text when present, else the compact question),
else the agent's last assistant message, else a short generic status word. This
SHALL apply to ALL lanes, INCLUDING archived (closed) agents — an archived row
SHALL show its last message or question rather than a generic archived hint.
Restore and delete actions remain available via the row's context menu.

#### Scenario: A pending question is shown
- **WHEN** an agent needs input and has a pending question
- **THEN** the status line shows the question text (not the generic "Needs input")

#### Scenario: The last message is shown when there is no pending question
- **WHEN** an agent needs input, has no pending question, and has a last assistant message
- **THEN** the status line shows that last assistant message

#### Scenario: Archived agents show their last message or question
- **WHEN** an archived (closed) agent is rendered in the archived lane
- **THEN** its status line shows its last message or pending question, not a generic "Archived" hint

#### Scenario: Generic fallback only when nothing is available
- **WHEN** an agent has neither a pending question nor any last assistant message yet
- **THEN** the status line falls back to a short generic word appropriate to its state

### Requirement: The agent card shows the model, not the cost

An agent card SHALL display the agent's MODEL — a human-readable, versioned label
such as "Opus 4.6", derived from the latest snapshot's model id and falling back to
the snapshot's model display name — in place of a dollar cost. The card SHALL NOT show
the per-agent dollar amount (cost remains tracked and surfaced in the aggregate total).

#### Scenario: Card shows the versioned model label
- **WHEN** an agent card renders for an agent whose latest snapshot has a model
- **THEN** the card shows the versioned model label (e.g. "Opus 4.6") and not a dollar amount

#### Scenario: Falls back to the display name
- **WHEN** the snapshot's model id cannot be parsed into a versioned label
- **THEN** the card shows the snapshot's model display name

#### Scenario: No per-agent cost on the card
- **WHEN** an agent card renders
- **THEN** no per-agent dollar cost is shown on the card
