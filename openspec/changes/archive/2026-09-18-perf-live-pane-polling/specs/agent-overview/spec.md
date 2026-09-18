## ADDED Requirements

### Requirement: Polling Is Bounded To Live Agents
Every clocked or event-driven poller that costs IO per agent (transcript activity reads, event timeline re-seeds, session title generation, and the subagents watched-set) SHALL cover only LIVE agent panes — closed (archived) panes are excluded, since a closed agent has no running process and no changing files. Closed panes MAY be primed once at mount so an archived row keeps its last summary, and restoring or previewing an archived agent SHALL return it to the live set immediately. The subagents watcher SHALL recompute only the session(s) a filesystem change belongs to (a change elsewhere in the projects tree costs no IO), SHALL derive a subagent transcript's time span from a bounded head + tail rather than the whole file, and SHALL serve transcript summaries, sink reads, and spans from a size+mtime cache when the file is unchanged.

#### Scenario: Closed agents leave the polling sets
- **WHEN** the workspace registries hold agent panes that are live, closed, shells, or lack a session id
- **THEN** the live pane-ref set contains only the live agent panes with a session id, while the all-panes set (used for one-shot in-memory seeding) also includes the closed ones

#### Scenario: Archived agents keep their seeded summary
- **WHEN** transcript activity is refreshed for the live panes only
- **THEN** a closed pane keeps the activity it was seeded with at mount, a live pane whose activity is unchanged keeps the same object, and a live pane the backend no longer resolves is dropped

#### Scenario: Watcher recomputes only the touched session
- **WHEN** a file changes under an unwatched session's directory
- **THEN** nothing is recomputed or emitted; and when a file changes under a watched session's directory, only that session is recomputed while the other watched sessions keep their cached rows in the emitted map

#### Scenario: Sessions touched maps paths to their session only
- **WHEN** a batch of changed paths is matched against the watched sessions
- **THEN** a path under `<session>/…` or the parent transcript `<session>.jsonl` maps to exactly that session (once), and a path elsewhere maps to none

#### Scenario: jsonl span reads bounded head and tail
- **WHEN** a subagent transcript is far larger than the head and tail windows
- **THEN** its first and last timestamps are still derived correctly, and a second read of the unchanged file is served from the size+mtime cache

#### Scenario: Summary is cached until the transcript changes
- **WHEN** a transcript's activity summary is read twice without the file changing
- **THEN** the second read is served from the size+mtime cache; once a line is appended the summary is re-derived

### Requirement: One Shared Roster Derivation
The app SHALL derive the agent roster ONCE, from a single shared 1 s clock, and every consumer (the needs-input alerts driver, the keep-awake driver, and the Inbox) SHALL read that one derivation rather than rebuilding the roster on its own clock. The clock SHALL be ref-counted so it runs while any consumer is mounted and stops with the last. Per-pane event activity SHALL be memoized on the pane's timeline identity so an unchanged pane is not re-derived on every tick.

#### Scenario: One shared roster clock serves every consumer
- **WHEN** two consumers start the shared roster clock and then stop it
- **THEN** a single interval ticks the clock while either is started, and it stops only after the last consumer stops

#### Scenario: Event activity is memoized per pane
- **WHEN** the derived event activity is requested for a pane whose timeline has not changed
- **THEN** the same activity object is returned; ingesting an event for another pane leaves this pane's memoized object untouched while the changed pane re-derives
