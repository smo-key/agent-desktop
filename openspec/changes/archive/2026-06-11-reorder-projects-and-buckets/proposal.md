## Why

The project list and the inbox buckets are ordered for you, with no way to
arrange them by hand. Projects sit in launch-recency order; agents in a bucket
follow the underlying pane-tree (or, for "Needs you", arrival order). When you
run many agents, the thing you care about right now is hard to keep at the top.

Two changes fix this: let the user **drag to reorder** (projects, and the agents
inside the "Needs you" and "Paused" buckets), and make every bucket default to
**most-recently-added-to-that-column first** so a freshly-arrived agent surfaces
at the top instead of being buried.

## What Changes

- **Drag to reorder projects.** The expanded project panel rows are draggable;
  dropping one onto another reorders the persisted `projects.json` list (so the
  collapsed icon rail, which mirrors the list, reorders too) and survives restart.
- **Drag to reorder agents in the Needs-you / Paused buckets.** Rows in those two
  buckets are draggable; dropping a row onto another in the SAME bucket moves it to
  that slot. The manual order for these two buckets persists across restarts
  (localStorage), keyed by pane id.
- **Most-recently-added-first default in every bucket.** Each bucket (Needs you,
  In flight, Paused, Archived) lists its agents newest-first by default: an agent
  that newly enters a bucket jumps to the TOP. A manual drag arrangement is kept
  for the agents already there; a new arrival still lands on top without disturbing
  the order below it.

As a consequence, the "Needs you" queue order flips from earliest-waiting-first to
newest-first. The auto-advance / queue-step contract is unchanged — it still
advances to the top of the queue and steps to the adjacent agent; only what counts
as "top/next" follows the new ordering.

Out of scope: reordering the In-flight / Archived buckets by hand (they are
newest-first only), cross-bucket drag (an agent's bucket is decided by its
status, not by dragging), and reordering in the collapsed project rail.

## Capabilities

- **projects** — adds drag-to-reorder of the project list (persisted).
- **agent-roster-display** — adds the most-recently-added-first bucket ordering and
  drag-to-reorder within the Needs-you / Paused buckets (persisted).
