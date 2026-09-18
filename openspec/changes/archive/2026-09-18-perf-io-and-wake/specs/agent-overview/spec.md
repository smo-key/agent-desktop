## ADDED Requirements

### Requirement: Background Work Yields When Hidden And After Wake
The app SHALL reduce background polling while its window is hidden and SHALL absorb a wake from sleep without a burst of work. While hidden, purely visual polls (project git status, the remote fetch) SHALL pause and the correctness backstops (the transcript safety poll and the event re-seed) SHALL keep running at a reduced rate, so a needs-input alert still fires for a backgrounded app. When the window becomes visible again, or a wake from sleep is detected (a heartbeat gap far beyond its interval — and a much larger gap while the window is hidden, where timers are throttled), everything deferred SHALL refresh once, immediately — except the remote fetch after a wake, which SHALL wait for the network to return. The subagents watcher SHALL do no IO in its filesystem callback and SHALL coalesce a burst of events (a streaming transcript, or the backlog replayed after a wake) into one recompute per touched session per burst window.

#### Scenario: Visual polls pause while the window is hidden
- **WHEN** a visual poll's interval ticks while the window is hidden
- **THEN** it does no work; while visible it runs on every tick

#### Scenario: Correctness backstops slow down but keep running while hidden
- **WHEN** a backstop poll's interval ticks while the window is hidden
- **THEN** it runs on every Nth tick only, and on every tick once visible

#### Scenario: A heartbeat gap far beyond its interval is a wake from sleep
- **WHEN** consecutive heartbeats are on time, or merely delayed by a throttled timer
- **THEN** no wake is detected; a gap at least the wake threshold beyond the interval is a wake

#### Scenario: A wake from sleep is detected once and triggers a resume
- **WHEN** a heartbeat observes a wake gap and the following heartbeats are back on schedule
- **THEN** the wake time is recorded and exactly one resume is signalled

#### Scenario: The remote fetch waits for the network after a wake
- **WHEN** a fetch would start inside the post-wake hold window
- **THEN** it is held until the window has elapsed; with no wake recorded it is never held

#### Scenario: Watcher coalesces a burst of events
- **WHEN** many files are written back-to-back under one watched session
- **THEN** the final emitted map reflects every write while far fewer maps are emitted than files written
