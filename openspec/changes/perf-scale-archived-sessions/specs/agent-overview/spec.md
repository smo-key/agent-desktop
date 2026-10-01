## ADDED Requirements

### Requirement: Re-Seeds Track The Live Session Set Not Snapshot Rate
The subagents watched-set re-seed and the event-timeline re-seed SHALL be keyed on a stable, value-comparable key of the app's session ids, so a statusline snapshot that does not change the set of session ids triggers no re-seed and no IPC. Per-snapshot work that resolves a pane to its session (the worktree-cwd adopt) SHALL use an indexed pane-to-session lookup rather than scanning every workspace registry.

#### Scenario: Session set key ignores snapshots that do not change the set
- **WHEN** a new snapshot map is produced that carries the same session ids as before (a cost or context update)
- **THEN** the session-set key is equal to the previous key, and it differs only when a session id is added or removed

#### Scenario: Session lookup by pane resolves through the workspace index
- **WHEN** a pane's session is looked up across many workspaces
- **THEN** the session is found in its own workspace's registry via the id index, focused-node and per-workspace session lookups agree with it, and an unknown pane resolves to undefined

### Requirement: Roster Rows Are Identity-Stable Across Ticks
The shared roster derivation SHALL reuse the previous tick's row object for every row whose fields are unchanged, and SHALL return the previous rows array itself when no row changed, so the 1 s clock does not invalidate downstream derivations and effects for archived or idle agents. Lane ordering SHALL use a precomputed per-lane rank rather than scanning the order list inside the sort comparator. An archived (closed) pane SHALL NOT mount a per-pane task badge timer.

#### Scenario: Unchanged roster rows keep their identity across ticks
- **WHEN** the roster is rebuilt and no row's fields changed
- **THEN** the stabilized result is the previous rows array itself

#### Scenario: A changed row is replaced while the others are reused
- **WHEN** the roster is rebuilt and exactly one row's status changed
- **THEN** the result is a new array in which the changed row is the new object and every other row is the previous object
