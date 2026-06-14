## ADDED Requirements

### Requirement: Notify the coordinator when a watched agent completes a turn
The system SHALL notify a coordinator when an agent it spawned with
notify-on-complete transitions from working to idle without a pending
`AskUserQuestion`. The notification SHALL be injected as an input turn into the
coordinator's pane, SHALL identify the originating agent (its title and pane id),
and SHALL include the agent's final transcript message when one is available. The
watch SHALL re-arm on the agent's next working transition so each completed turn
produces at most one completion notification.

#### Scenario: Watched agent finishes a turn
- **WHEN** an agent marked notify-on-complete goes from working to idle with no pending question
- **THEN** a notification identifying the agent and carrying its final message is delivered to its coordinator

#### Scenario: One notification per completed turn
- **WHEN** a watched agent completes a turn, then later starts working and completes another turn
- **THEN** the coordinator receives one notification per completed turn, not a continuous stream while the agent sits idle

#### Scenario: A pending question is not a completion
- **WHEN** a watched agent becomes idle because it is blocked on a pending `AskUserQuestion`
- **THEN** no completion notification is sent for that transition

### Requirement: Opt out of completion notifications
An agent spawned with `notifyOnComplete` disabled SHALL NOT produce completion
notifications, neither on turn completion nor on session end.

#### Scenario: Fire-and-forget agent is silent
- **WHEN** an agent spawned with notify-on-complete disabled completes a turn or its session ends
- **THEN** no completion notification is sent to the coordinator

### Requirement: Notify the coordinator when a watched agent exits
The system SHALL send a final notification to the coordinator when a
notify-on-complete agent's session ends, identifying the agent.

#### Scenario: Watched agent session ends
- **WHEN** a notify-on-complete agent's session ends
- **THEN** a final notification identifying that agent is delivered to its coordinator

### Requirement: Deliver agent-initiated updates to the coordinator
The system SHALL deliver a `message_coordinator` update as an input turn injected
into the target coordinator's pane, identifying the originating agent (its title
and pane id) and carrying the agent's text.

#### Scenario: Agent update reaches the coordinator
- **WHEN** a spawned agent's `message_coordinator` update is routed to a running coordinator
- **THEN** the update is injected into the coordinator's pane identifying the originating agent and its text

### Requirement: Notifications are queued durably until the coordinator is idle
Notifications targeting a busy coordinator SHALL be held in a per-coordinator
queue and delivered once the coordinator becomes idle. Unlike a bounded
message-delivery wait, a queued notification SHALL NOT be dropped or errored
because the coordinator stayed busy; it persists until the coordinator can accept
input.

#### Scenario: Notification held while coordinator is busy
- **WHEN** a notification is produced while the coordinator is mid-turn
- **THEN** it is held and delivered after the coordinator returns to idle, not dropped

### Requirement: Coalesce queued notifications into a single turn
When more than one notification is queued for a coordinator, the system SHALL
coalesce all currently-queued notifications into a single injected turn when the
coordinator becomes idle, rather than injecting one turn per notification.

#### Scenario: Multiple notifications batched
- **WHEN** several notifications are queued for a coordinator while it is busy
- **THEN** they are delivered together as one injected turn when it becomes idle

### Requirement: Notification delivery is idle-gated and per-coordinator serialized
Delivery into a coordinator pane SHALL occur only when the coordinator is idle
(not mid-turn and not sitting on an interactive menu), and deliveries to one
coordinator SHALL NOT interleave.

#### Scenario: No delivery into a busy or menu-bound coordinator
- **WHEN** the coordinator is mid-turn or sitting on an interactive menu
- **THEN** no notification turn is injected until it is idle

#### Scenario: Deliveries to one coordinator do not interleave
- **WHEN** a new notification arrives while a delivery to the same coordinator is in progress
- **THEN** the deliveries are serialized rather than interleaved

### Requirement: No coordinator means no delivery
When a notification's target coordinator is not running, the system SHALL NOT
deliver it: a completion or exit notification SHALL be discarded without error,
and an agent-initiated `message_coordinator` SHALL surface the no-coordinator
condition to the calling agent.

#### Scenario: Completion with no coordinator
- **WHEN** a watched agent completes or exits but its coordinator is no longer running
- **THEN** no notification is delivered and nothing errors in the app

#### Scenario: Agent update with no coordinator
- **WHEN** a spawned agent calls `message_coordinator` but no coordinator is running for its project
- **THEN** the calling agent receives a structured error and nothing is injected
