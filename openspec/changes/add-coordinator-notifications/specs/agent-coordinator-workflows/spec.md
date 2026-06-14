## ADDED Requirements

### Requirement: Coordinator works event-driven and yields after delegating
The coordinator SHALL operate event-driven rather than polling: after delegating
work it SHALL end its turn instead of repeatedly calling `list_agents` /
`read_agent` to watch for progress. The coordinator's system prompt SHALL instruct
it to yield once it has no immediate planning or delegation to do, and SHALL tell
it that it will be woken when an agent reports via `message_coordinator` or
completes (for agents spawned with `notifyOnComplete`). The prompt SHALL tell the
coordinator to leave `notifyOnComplete` at its default (`true`), or set it
explicitly, for any agent whose completion it needs to act on. An idle coordinator
that is waiting for notifications SHALL NOT be flagged as needing input (per the
existing needs-input requirement).

#### Scenario: Coordinator yields after delegating
- **WHEN** the coordinator has spawned/messaged the agents it needs and has no further immediate planning
- **THEN** it ends its turn rather than polling agent status in a loop

#### Scenario: Coordinator is woken by a completion
- **WHEN** an agent the coordinator spawned with notify-on-complete finishes a turn
- **THEN** the coordinator receives a notification and can act on it without having polled

#### Scenario: Coordinator is woken by an agent update
- **WHEN** a spawned agent sends an update via `message_coordinator`
- **THEN** the coordinator receives that update and can act on it without having polled

#### Scenario: Idle waiting coordinator is not flagged as needing input
- **WHEN** the coordinator has yielded and is waiting for notifications
- **THEN** it is not shown as needing input
