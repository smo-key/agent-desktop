## ADDED Requirements

### Requirement: Reconciliation Reads Are Cached And Change-Skipping
The periodic safety re-seed SHALL cover only the live agent panes, `events_for` SHALL serve durable-sink reads and transcript backfills from a size+mtime cache when the file is unchanged, and the frontend SHALL skip the reactive write when the merged snapshot equals the timeline it already holds (same length, and the same `ts`, hook name, and synthetic flag at every position), so an idempotent re-seed re-runs no derived value.

#### Scenario: Sink and backfill are cached by size and mtime
- **WHEN** a session's durable sink or a transcript backfill is read twice without the file changing
- **THEN** the second read is served from the cache; an appended event (a grown file) is re-read, and a missing file yields an empty list without being cached

#### Scenario: An unchanged re-seed writes nothing
- **WHEN** a safety re-seed returns exactly the events the timeline already holds
- **THEN** the pane's timeline array and its memoized activity keep their identity; a genuinely newer snapshot still lands
