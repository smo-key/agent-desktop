## ADDED Requirements

### Requirement: Alert on entry into Needs input

The system SHALL raise an alert when a live agent enters the "Needs input" state —
that is, when the agent becomes `needsAttention` (status `waiting` or `error`, and
not paused, archived, or previewing). The alert SHALL be edge-triggered: it fires
exactly once at the transition INTO the state, and SHALL NOT repeat while the agent
remains in that state. An agent that leaves and later re-enters the state SHALL
alert again on the new entry. Agents that are paused, archived, or previewing SHALL
NOT alert.

#### Scenario: Agent goes quiet at its prompt

- **WHEN** a live agent transitions from `working` to `waiting`
- **THEN** an alert is raised once for that agent

#### Scenario: Agent errors out

- **WHEN** a live agent transitions to `error`
- **THEN** an alert is raised once for that agent

#### Scenario: Agent stays waiting

- **WHEN** an agent that already alerted remains `waiting` across subsequent roster recomputes
- **THEN** no further alert is raised for that agent

#### Scenario: Agent re-enters Needs input

- **WHEN** an agent goes `waiting` → `working` → `waiting`
- **THEN** an alert is raised again on the second entry into `waiting`

#### Scenario: Paused or archived agent

- **WHEN** an agent is `waiting` or `error` but is paused, archived, or previewing
- **THEN** no alert is raised for that agent

### Requirement: Independent sound and desktop channels

The system SHALL provide two independent alert channels — a sound chime and an OS
desktop notification — that fire independently of each other. For each entry into
"Needs input", each channel SHALL fire only if that channel's own mode permits it
(see "Per-channel alert mode"). Enabling, disabling, or configuring one channel
SHALL NOT affect the other.

#### Scenario: Sound only

- **WHEN** an agent enters Needs input, the sound channel's mode permits it, and the desktop channel's mode is `off`
- **THEN** the chime plays and no desktop notification is shown

#### Scenario: Desktop only

- **WHEN** an agent enters Needs input, the desktop channel's mode permits it, and the sound channel's mode is `off`
- **THEN** a desktop notification is shown and no chime plays

#### Scenario: Both channels

- **WHEN** an agent enters Needs input and both channels' modes permit it
- **THEN** both the chime plays and a desktop notification is shown

#### Scenario: Both channels off

- **WHEN** an agent enters Needs input and both channel modes are `off`
- **THEN** no chime plays and no desktop notification is shown

### Requirement: Per-channel alert mode

Each channel SHALL have its own alert mode, one of `off`, `app-unfocused`,
`agent-unfocused`, or `always`, which decides whether an entry into "Needs input"
alerts on that channel, given the OS window focus state and which agent the user is
currently viewing (the inbox focus agent in overview, or the active pane in grid):

- `off` — never alert on this channel.
- `app-unfocused` — alert only when the Agent Desktop window does not have OS focus.
- `agent-unfocused` — alert unless the user is actively viewing that exact agent in
  a focused window; equivalently, alert when the window is unfocused OR the viewed
  agent is not the one entering Needs input.
- `always` — alert on every entry, regardless of focus or viewed agent.

#### Scenario: Mode off

- **WHEN** a channel's mode is `off` and an agent enters Needs input
- **THEN** that channel does not alert, regardless of focus

#### Scenario: Mode always

- **WHEN** a channel's mode is `always` and an agent enters Needs input
- **THEN** that channel alerts, whether or not the window is focused or the agent is being viewed

#### Scenario: Mode app-unfocused, window unfocused

- **WHEN** a channel's mode is `app-unfocused`, the app window is not focused, and an agent enters Needs input
- **THEN** that channel alerts

#### Scenario: Mode app-unfocused, window focused

- **WHEN** a channel's mode is `app-unfocused`, the app window is focused, and an agent enters Needs input
- **THEN** that channel does not alert

#### Scenario: Mode agent-unfocused, viewing that agent

- **WHEN** a channel's mode is `agent-unfocused`, the app window is focused, the user is viewing the agent that enters Needs input
- **THEN** that channel does not alert

#### Scenario: Mode agent-unfocused, viewing a different agent

- **WHEN** a channel's mode is `agent-unfocused`, the app window is focused, and an agent OTHER than the one being viewed enters Needs input
- **THEN** that channel alerts

#### Scenario: Mode agent-unfocused, window unfocused

- **WHEN** a channel's mode is `agent-unfocused`, the app window is not focused, and an agent enters Needs input
- **THEN** that channel alerts

### Requirement: No alerts for pre-existing waiters at launch

The system SHALL prime its edge detector on the first roster it observes: every
agent already in "Needs input" at that first observation SHALL be treated as the
baseline and SHALL NOT alert. Only agents that enter "Needs input" AFTER the first
observation SHALL alert.

#### Scenario: Agents already waiting at mount

- **WHEN** the inbox first observes a roster in which one or more agents are already `waiting` or `error`
- **THEN** no alert is raised for any of those already-waiting agents

#### Scenario: New waiter after priming

- **WHEN** an agent enters Needs input on a roster recompute after the first observation
- **THEN** an alert is raised for that agent (subject to channel modes)

### Requirement: Desktop notification content and permission

When the desktop channel alerts, the system SHALL show an OS desktop notification
whose title indicates an agent needs input and whose body identifies the agent
(its display name) together with its pending question or most recent message,
clipped to a single line. The system SHALL request OS notification permission when
the desktop channel is set to any mode other than `off` and permission has not yet
been granted. When permission is denied, or when running outside the desktop shell
(e.g. the web preview) so notifications are unavailable, the desktop channel SHALL
silently no-op without throwing; the sound channel SHALL be unaffected.

#### Scenario: Notification shown with agent context

- **WHEN** the desktop channel alerts for an agent named "parser" that is asking a question
- **THEN** a desktop notification is shown whose title indicates an agent needs input and whose body includes "parser" and the question text on one line

#### Scenario: Permission requested on enable

- **WHEN** the user sets the desktop channel to a non-`off` mode and OS notification permission has not been granted
- **THEN** the system requests OS notification permission

#### Scenario: Permission denied

- **WHEN** the desktop channel would alert but OS notification permission is denied
- **THEN** no desktop notification is shown, no error surfaces, and the sound channel still alerts if its mode permits

#### Scenario: Non-desktop context

- **WHEN** the desktop channel would alert but the app is running outside the Tauri shell
- **THEN** the desktop channel no-ops without throwing

### Requirement: Persisted channel modes with opt-in defaults

The system SHALL persist both channel modes in a `notifications` slice of the
shared settings store, merged so sibling settings slices are preserved. On a fresh
install both channel modes SHALL default to `off` (the feature is silent and
opt-in). The system SHALL tolerate a missing, malformed, or wrongly-typed slice by
falling back to `off` for each channel.

#### Scenario: Fresh install defaults

- **WHEN** there is no persisted `notifications` slice
- **THEN** both the sound and desktop channel modes are `off`

#### Scenario: Persisted modes load

- **WHEN** the `notifications` slice records sound mode `always` and desktop mode `app-unfocused`
- **THEN** those modes are loaded and used

#### Scenario: Malformed slice

- **WHEN** the `notifications` slice is not an object, or a channel mode is missing or not a recognized value
- **THEN** that channel's mode falls back to `off`

#### Scenario: Saving preserves siblings

- **WHEN** a channel mode is changed and saved
- **THEN** the `notifications` slice is written without clobbering other settings slices

### Requirement: Configure alerts from Settings

The system SHALL expose the two channel modes in the Settings modal as two
independent pickers — one for the sound channel and one for the desktop channel —
each offering `off`, `app-unfocused`, `agent-unfocused`, and `always`. Changing a
picker SHALL persist the new mode and take effect for subsequent alerts without a
restart.

#### Scenario: Change a channel mode

- **WHEN** the user changes the sound channel picker from `off` to `always`
- **THEN** the new mode is persisted and the next agent that enters Needs input plays the chime

#### Scenario: Channels configured independently

- **WHEN** the user sets the sound picker and the desktop picker to different modes
- **THEN** each channel alerts according to its own mode
