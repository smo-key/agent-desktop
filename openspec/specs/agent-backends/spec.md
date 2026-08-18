# agent-backends Specification

## Purpose
Define the registry of agent backends (Claude Code, GitHub Copilot) — each backend's launch arguments, capability flags, and per-backend behavior — plus backend resolution for launches and the Settings agent choice.
## Requirements
### Requirement: Agent backend registry and descriptor
The system SHALL define a registry of agent backends keyed by an agent kind
(`claude`, `copilot`), where each backend declares: its executable program
name, fresh-launch arguments (given an app-minted session UUID), resume
arguments (given a session UUID), MCP-config argument style, a model-id →
human label formatter, startup readiness timing (quiet window, hard cap,
submit delay), terminal busy-marker strings, and capability flags (at minimum:
hooks, statusline, context percentage, tasks directory, subagent rows,
specialist launch, in-TUI question answering). All backend-specific behavior
SHALL be looked up through this registry rather than compared against a
hard-coded program name.

#### Scenario: Claude backend descriptor
- **WHEN** the backend registry resolves kind `claude`
- **THEN** it declares program `claude`, fresh args carrying `--session-id <uuid>`, resume args carrying `--resume <uuid>`, and capability flags with hooks, statusline, context percentage, tasks directory, subagent rows, specialist launch, and question answering all supported

#### Scenario: Copilot backend descriptor
- **WHEN** the backend registry resolves kind `copilot`
- **THEN** it declares program `copilot`, fresh args carrying `--session-id <uuid>` and `--no-remote`, resume args carrying `--resume <uuid>`, and capability flags declaring no hooks, no statusline, no context percentage, and no tasks directory

#### Scenario: Agent-pane checks consult the registry
- **WHEN** app code needs to know whether a pane is an agent pane (vs a plain shell)
- **THEN** it asks the registry whether the pane's program is a known agent backend, and a `copilot` pane answers yes exactly like a `claude` pane

### Requirement: Backend resolution for a launch
The system SHALL resolve the backend for a new agent session as: the
launcher's per-session agent selection when present, otherwise the global
agent setting, otherwise `claude`. The resolved kind SHALL be recorded on the
pane's registry entry and persisted with the layout so restarts and
archive/restore reuse the same backend.

#### Scenario: Global default applies
- **WHEN** the user has set the global agent setting to Copilot and launches a session without touching the launcher's agent selector
- **THEN** the session spawns the `copilot` backend

#### Scenario: Per-session override wins
- **WHEN** the global agent setting is Claude and the user picks Copilot in the launcher for one session
- **THEN** that session spawns `copilot` while the global setting and subsequent launches remain Claude

#### Scenario: Persisted panes keep their backend
- **WHEN** the app restarts with a persisted Copilot pane in the layout
- **THEN** the pane is restored as a `copilot` pane (including resume semantics), not reinterpreted under the current global default

### Requirement: Agent choice in Settings with install detection
The Settings modal SHALL offer an "Agent" selection (Claude Code / GitHub
Copilot) that persists as its own settings slice via the shared settings
read-modify-write merge. The system SHALL detect whether the selected
backend's executable is discoverable on the resolved login-shell PATH and,
when it is not, SHALL show a quiet non-blocking hint naming the install
command; the selection itself SHALL still be allowed.

#### Scenario: Choosing Copilot persists the slice
- **WHEN** the user selects GitHub Copilot in Settings
- **THEN** the `agent` settings slice records the choice without clobbering sibling slices, and new launches default to Copilot

#### Scenario: Missing CLI shows a hint, not a block
- **WHEN** the user selects a backend whose executable is not found on the resolved PATH
- **THEN** Settings shows a non-blocking "not installed" hint with the install command, and the selection is saved

### Requirement: Unsupported capabilities degrade by omission
The UI SHALL omit any feature gated on a backend capability flag the backend
does not declare (no control, no empty placeholder, no error), and the pane
SHALL otherwise behave as a first-class agent pane.

#### Scenario: Copilot pane renders without Claude-only chrome
- **WHEN** a Copilot pane is focused
- **THEN** the context-percentage meter and task badge are absent (not rendered empty), while status, title, model label, and activity affordances render normally
