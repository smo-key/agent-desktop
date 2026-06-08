# usage-dashboard Specification

## Purpose
TBD - created by archiving change add-usage-bootstrap-session. Update Purpose after archive.
## Requirements
### Requirement: Startup Usage-Bootstrap Session

On startup the system SHALL spawn a hidden `claude` TUI session — one with no UI
pane, whose output is discarded — wired into the snapshot pipeline (the
statusline wrapper as its `statusLine.command`, plus `AGENT_DESKTOP_SNAPSHOT_DIR`
and a stable `AGENT_DESKTOP_PANE` in its environment) purely so its first
statusline render populates the account-wide `rate_limits` into a snapshot the
watcher picks up, and SHALL kill that session after a bounded TTL of 30 seconds.
The bootstrap session SHALL keep its session local (`remoteControlAtStartup:
false`) and SHALL NOT wire the event-hook lifecycle, so it never appears in the
overview's event timeline or subagents. Resolving the usage paths or spawning the
session is best-effort: a failure SHALL be logged and otherwise ignored, never
blocking startup.

#### Scenario: Rate limits populated before any user session

- **WHEN** the app starts and the user has not yet opened any session
- **THEN** the backend spawns the hidden bootstrap `claude` session wired into the
  snapshot pipeline
- **AND** its first statusline render writes a snapshot carrying the account
  `rate_limits`, so the dashboard's 5h/7d bars become available from that newest
  snapshot rather than rendering empty

#### Scenario: Bootstrap session killed after the TTL

- **WHEN** the hidden bootstrap session has been running for 30 seconds
- **THEN** the backend kills it (idempotently — a child that already exited is a
  no-op) and removes it from the pane registry, so no throwaway `claude` process
  lingers and it is not double-killed on app quit

#### Scenario: Bootstrap session excluded from the overview

- **WHEN** the hidden bootstrap session runs
- **THEN** it is launched WITHOUT the event-hook lifecycle wiring (no
  `AGENT_DESKTOP_SOCKET_PATH`, no `hooks` in its `--settings`)
- **AND** it therefore produces no overview event-timeline entries or subagents,
  remaining invisible to the user

#### Scenario: Best-effort startup never blocks

- **WHEN** the usage paths cannot be resolved or the bootstrap session fails to
  spawn
- **THEN** the failure is logged and ignored, the app finishes starting normally,
  and the dashboard simply stays in its empty rate-limit state until the user
  opens a session

