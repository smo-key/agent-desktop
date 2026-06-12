# agent-roster-display Specification

## Purpose
TBD - created by archiving change agent-session-ux-improvements. Update Purpose after archive.
## Requirements
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

### Requirement: The agent card hides context until a size is known

An agent card SHALL show the context-window measure (the mini-bar and percent) ONLY
when a context size is actually known for that agent. WHEN the agent has no context
percentage yet (the value is unknown/null — e.g. a just-spawned agent whose first
snapshot has not landed), the card SHALL OMIT the context bar and percent entirely
rather than render a placeholder dash or an empty/striped bar. Archived, previewed,
and paused agents continue to omit the context measure as before.

#### Scenario: Context shown once known
- **WHEN** an agent card renders for a live agent whose context percentage is known
- **THEN** the card shows the context mini-bar and percent

#### Scenario: Context hidden when unknown
- **WHEN** an agent card renders for an agent that has no context percentage yet (unknown/null)
- **THEN** the card shows neither the context bar nor a percent (no placeholder dash or empty bar)

### Requirement: Buckets default to most-recently-added-first and are reorderable
Each roster bucket (Needs you, In flight, Paused, Archived) SHALL list its agents
with the most recently added to THAT bucket first: an agent that newly enters a
bucket SHALL appear at the TOP of it. A user-arranged (dragged) order SHALL be kept
for the agents already in the bucket; a new arrival SHALL still land on top without
disturbing the order below it, and an agent that leaves a bucket SHALL drop out
while the rest keep their order. A bucket that is momentarily empty (e.g. while the
layout restore is still loading) SHALL retain its remembered order rather than
discard it.

The Needs-you and Paused buckets SHALL be manually reorderable by dragging a row
onto another row in the SAME bucket, moving the dragged agent to the drop target's
slot. The pinned coordinator row SHALL NOT be draggable. The manual order for these
two buckets SHALL persist across restarts (keyed by pane id); the In-flight and
Archived buckets are most-recently-added-first only (not hand-reorderable).

As a consequence, the Needs-you queue is ordered newest-first; the auto-advance and
queue-step behavior is unchanged (it follows the queue order — top is "next").

#### Scenario: Default order is most recently added to the column first
- **WHEN** a bucket's display order is reconciled against the agents currently in it
- **THEN** an agent newly in the bucket is placed at the top, above the existing order, and the order otherwise reflects most-recently-added-first

#### Scenario: A manual order is preserved as agents enter and leave the column
- **WHEN** the user has dragged a bucket into a custom order and the roster recomputes
- **THEN** the custom order of the still-present agents is preserved, a newly-arrived agent jumps to the top without disturbing it, and an agent that left the bucket is dropped

#### Scenario: An empty column keeps its remembered order (restart-safe, never wiped)
- **WHEN** a bucket has no current members (e.g. the roster is briefly empty while the layout restore is in flight)
- **THEN** the bucket's remembered order is retained (not cleared or persisted as empty), so the saved arrangement is restored when its agents reappear

#### Scenario: Dragging an agent moves it to the drop target within its bucket
- **WHEN** an agent in the Needs-you or Paused bucket is dragged and dropped onto another agent in the same bucket
- **THEN** the dragged agent is moved to the drop target's position within that bucket and the new order is persisted
- **AND** a drop onto itself, or onto an agent in a different bucket, makes no change

