## ADDED Requirements

### Requirement: Transcript Reads Are Incremental And Bounded
Transcript-derived reads that run while agents work SHALL cost proportional to what changed, not to the transcript's total size. The user-message count SHALL be cached per transcript by byte offset and parse only bytes appended since the last read, resetting when the file shrinks or is replaced, and SHALL JSON-parse only candidate lines. The durable event-sink read served to a pane SHALL return at most the in-memory ring capacity of most-recent events. The subagent parent-tool scan SHALL skip lines that cannot hold a tool block without JSON-parsing them. Whole-transcript reads issued by `session_focus` SHALL run on the blocking pool, not on an async worker.

#### Scenario: User message count is incremental on append
- **WHEN** the user-message count is read, then user and assistant lines are appended, then it is read again
- **THEN** the second count equals a full recount of the file, and only the appended bytes were parsed

#### Scenario: User message count resets when the file shrinks
- **WHEN** a transcript's user-message count is cached and the file is then truncated and rewritten shorter
- **THEN** the next read recounts from the start rather than reusing the stale offset

#### Scenario: Sink read returns only the ring cap tail
- **WHEN** a session's durable event sink holds more events than the ring capacity
- **THEN** the sink read returns exactly the most recent ring-capacity events, in order

#### Scenario: Parent tool scan ignores lines without tool blocks
- **WHEN** the parent transcript tail mixes prose lines with Agent tool_use and tool_result lines
- **THEN** the running/finished tool state matches a full parse of every line

### Requirement: Event-Driven Activity Refresh Is Coalesced
The transcript activity refresh triggered by hook events (`Stop`, `PostToolUse`, `SubagentStop`) SHALL be coalesced (and the wake-from-sleep refresh and the slow safety poll SHALL go through the same coalesced runner): a burst of events from any agents SHALL produce one trailing refresh, and a refresh SHALL NOT start while a previous one is still in flight (a request arriving meanwhile runs once after it completes).

#### Scenario: A burst of hook events triggers one activity refresh
- **WHEN** many hook events arrive within the coalescing window
- **THEN** the activity refresh runs once after the window, not once per event

#### Scenario: A refresh requested while one is in flight runs once afterwards
- **WHEN** a refresh is requested while the previous refresh has not completed
- **THEN** no second refresh overlaps it, and exactly one follow-up refresh runs after it completes
