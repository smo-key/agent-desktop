## ADDED Requirements

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
