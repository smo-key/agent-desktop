## ADDED Requirements

### Requirement: Launcher Agent Selection
The launcher SHALL show which agent backend the session will use, seeded from
the global agent setting, and SHALL let the user override it for the pending
session only. The launch plan SHALL carry the resolved agent kind instead of a
hard-coded program, and startup readiness timing (quiet window, hard cap,
submit delay) for initial-prompt delivery SHALL come from the resolved
backend's descriptor.

#### Scenario: Launcher seeds from the global setting
- **WHEN** the launcher opens while the global agent setting is Copilot
- **THEN** the agent selector shows Copilot and launching spawns `copilot`

#### Scenario: One-off override does not change the default
- **WHEN** the user overrides the launcher's agent to Claude for one launch
- **THEN** that session spawns `claude` and the next launcher open still seeds from the unchanged global setting

#### Scenario: Initial prompt uses backend timing
- **WHEN** a session launches with an initial prompt
- **THEN** prompt delivery waits for the spawned backend's declared startup-quiet window (falling back to its hard cap), not Claude-calibrated constants baked into the launcher

## MODIFIED Requirements

### Requirement: Spawn Claude With Wrapper Override And Pane Env

The system SHALL spawn the resolved agent backend's program in the chosen
`cwd` with the `AGENT_DESKTOP_PANE` and `AGENT_DESKTOP_SNAPSHOT_DIR`
environment variables set. For a `claude` session, the statusline-wrapper
SHALL additionally be applied via a `--settings` override so the session joins
the usage dashboard through the statusline pipeline. For a backend that does
not declare statusline/hook support (e.g. `copilot`), the spawn SHALL pass
only that backend's declared launch arguments and SHALL NOT inject
Claude-specific `--settings`, hooks, or statusline configuration.

#### Scenario: Spawn carries the statusline override and pane env

- **WHEN** the launcher spawns a `claude` session for a chosen `cwd`
- **THEN** the `claude` process is launched with `--settings` set to inline JSON of the form `{"statusLine":{"type":"command","command":"<abs>/statusline-wrapper.js"}}` pointing at the app-support `bin/statusline-wrapper.js`
- **AND** the process environment includes a unique `AGENT_DESKTOP_PANE=<uuid>` matching the new pane's id and `AGENT_DESKTOP_SNAPSHOT_DIR` set to the app-support snapshots directory
- **AND** the process environment also seeds `TERM=xterm-256color`, `COLORTERM=truecolor`, plus inherited `PATH`/`HOME`/`LANG` so `claude` is discoverable under the sparse macOS GUI env

#### Scenario: Global settings are not mutated

- **WHEN** a session is spawned through the launcher
- **THEN** the user's global `~/.claude/settings.json` is left byte-identical and the override is applied only to the spawned session via the `--settings` flag

#### Scenario: Copilot spawn is minimal and clean

- **WHEN** the launcher spawns a `copilot` session for a chosen `cwd`
- **THEN** the process is launched with the Copilot backend's declared args (`--session-id <uuid>`, `--no-remote`) plus the same pane env (`AGENT_DESKTOP_PANE`, `AGENT_DESKTOP_SNAPSHOT_DIR`, terminal env seeding)
- **AND** no `--settings`, statusline, or hook configuration is injected, and the user's `~/.copilot` configuration is not mutated
