## ADDED Requirements

### Requirement: Activating a needs-input notification focuses its agent

The application SHALL raise and focus the Mission Control window when the user
activates (clicks the body of) an agent's "Needs input" desktop notification,
and SHALL select that agent in the overview so its terminal is shown when the
alerting agent still has a live session.

#### Scenario: Clicking a live agent's notification focuses that agent

- **WHEN** the user clicks a needs-input notification whose agent still has a
  live pane
- **THEN** the Mission Control window is raised, unminimized, and focused
- **AND** the overview becomes the active view
- **AND** that agent is selected in the overview (its terminal is shown)

#### Scenario: Clicking a notification for an ended agent focuses only the window

- **WHEN** the user clicks a needs-input notification whose agent's session has
  ended (no live pane carries its `paneId`)
- **THEN** the Mission Control window is raised, unminimized, and focused
- **AND** no agent selection is changed

#### Scenario: Re-activating the same agent re-focuses it

- **WHEN** the user clicks a needs-input notification for an agent that is
  already the selected agent
- **THEN** the window is focused and that agent is re-selected (its terminal is
  re-focused), rather than the activation being ignored

### Requirement: macOS delivers notification clicks via a custom path

On macOS the application SHALL send needs-input notifications through a custom
path that captures the body click and signals the renderer with the alerting
agent's `paneId`, because the bundled notification plugin does not deliver click
events on desktop. On non-macOS platforms the existing notification send path
SHALL be unchanged.

#### Scenario: A macOS notification body click signals the agent

- **WHEN** a needs-input notification is sent on macOS and the user clicks its
  body
- **THEN** the application emits an activation signal carrying that agent's
  `paneId` to the renderer

#### Scenario: Non-macOS notifications retain current behavior

- **WHEN** a needs-input notification is sent on a non-macOS platform
- **THEN** the notification is delivered through the existing plugin path
- **AND** no click activation is wired (the notification is informational only)

### Requirement: Click activation degrades gracefully

Notification click activation SHALL never prevent an alert from being shown and
SHALL never raise an error when the click round-trip is unavailable — for
example in an unsigned or development build, or when OS notification permission
is denied.

#### Scenario: Unavailable round-trip does not break alerting

- **WHEN** the custom notification path cannot deliver a notification or capture
  a click (e.g. an unsigned/dev build or denied permission)
- **THEN** the needs-input alert still fires through its remaining channels
  without throwing
- **AND** no window focus or agent selection occurs

#### Scenario: An activation for an unknown pane is a no-op selection

- **WHEN** an activation signal is received for a `paneId` that no current
  roster row carries
- **THEN** the window is focused
- **AND** no agent selection is changed
