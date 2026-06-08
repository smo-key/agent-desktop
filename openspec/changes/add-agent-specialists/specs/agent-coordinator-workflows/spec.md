## ADDED Requirements

### Requirement: One coordinator per project, started on demand
The system SHALL allow at most one coordinator agent per project. A coordinator
SHALL NOT start automatically; it MUST be started by an explicit user action for
that project. Starting when one already runs SHALL reuse the existing coordinator
rather than launching a second.

#### Scenario: Starting a coordinator for a project without one
- **WHEN** the user invokes "Start coordinator" for a project that has no running coordinator
- **THEN** the system launches a coordinator agent bound to that project
- **AND** the coordinator becomes the project's single coordinator

#### Scenario: Starting when one already runs reuses it
- **WHEN** the user invokes "Start coordinator" for a project whose coordinator is already running
- **THEN** the system does not launch a second coordinator
- **AND** it focuses / reuses the existing coordinator

### Requirement: Coordinator is a claude pane with the toolkit attached
The coordinator SHALL be a `claude` session running in a PTY pane bound to the
project, marked with a coordinator role. It MUST be launched with the
`agent-orchestration-runtime` toolkit attached and with an orchestrator system
prompt that defines its role: take a goal and plan, spawn and coordinate
specialists and existing sessions to accomplish it.

#### Scenario: Coordinator launch wiring
- **WHEN** a coordinator is started for a project
- **THEN** the launched pane runs `claude` with `cwd` inside the project and a coordinator role marker
- **AND** the orchestration toolkit is configured for that session
- **AND** the orchestrator system prompt is applied

### Requirement: Coordinator persists and is reused for the session
Once started, a coordinator SHALL persist for the app session and be reused. The
project SHALL record its coordinator session (a back-reference) so it is not
duplicated and can be identified after focus changes or restart.

#### Scenario: Coordinator persists across navigation
- **WHEN** the user navigates away from and back to a project with a running coordinator
- **THEN** the same coordinator session is still running and is reused

#### Scenario: Project records its coordinator
- **WHEN** a coordinator is running for a project
- **THEN** the project records that coordinator's session so a second one is not started

### Requirement: Coordinator runs dynamic workflows over specialists and existing sessions
Given a goal, the coordinator SHALL orchestrate a dynamic, ephemeral workflow
using the toolkit — spawning specialists and reading / messaging both those
specialists and the user's existing project sessions — iterating until the goal is
met. The system SHALL NOT persist a workflow definition and SHALL NOT provide a
visual workflow builder.

#### Scenario: Coordinator orchestrates specialists toward a goal
- **WHEN** the user gives the coordinator a goal
- **THEN** the coordinator spawns the needed specialists as panes and coordinates them via the toolkit until the goal is met

#### Scenario: Coordinator weaves in an existing session
- **WHEN** a goal involves a `claude` session the user already started in the project
- **THEN** the coordinator can read and message that existing session as part of the workflow

#### Scenario: No stored or visual workflow
- **WHEN** a workflow completes
- **THEN** no workflow definition is persisted and no builder UI is involved

### Requirement: Coordinator delegates all work and cannot perform it directly
The coordinator SHALL NOT perform work itself — no file edits, shell commands,
notebook edits, or other direct task execution. It SHALL accomplish a goal only by
creating sessions (optionally as specialists) and coordinating them via the
toolkit. The coordinator's launch SHALL restrict its available tools so the work
tools (file write/edit, shell, notebook edit) and the internal `Task` tool are
unavailable, while the orchestration toolkit (and read-only inspection) remain
available.

#### Scenario: Coordinator launch excludes work tools
- **WHEN** a coordinator is started for a project
- **THEN** its available tools exclude the work tools (file write/edit, shell, notebook edit) and the internal `Task` tool
- **AND** the orchestration toolkit remains available

#### Scenario: Coordinator delegates rather than doing the work
- **WHEN** the coordinator is given a goal that requires doing work
- **THEN** it creates one or more sessions (optionally specialists) to perform the work
- **AND** it does not perform the work in its own session

### Requirement: Coordinator is pinned to the top of the Sessions list
The coordinator SHALL appear at the top of the Sessions list, above all other
sessions, separated from them by a horizontal rule, with no separate heading for
it. When the active project has no running coordinator, the Sessions list SHALL
show a focusable "Start coordinator" affordance in that top position. Focusing it
SHALL show an empty main-pane state inviting the user to click a Start button to
launch the orchestrator; clicking Start SHALL launch the coordinator.

#### Scenario: Running coordinator is pinned at the top
- **WHEN** a project has a running coordinator
- **THEN** the coordinator appears at the top of the Sessions list above all other sessions
- **AND** a horizontal rule separates it from the remaining sessions
- **AND** there is no separate heading for it

#### Scenario: Start affordance shown when no coordinator
- **WHEN** the active project has no running coordinator
- **THEN** a focusable "Start coordinator" affordance appears at the top of the Sessions list

#### Scenario: Focusing the not-started coordinator shows a Start prompt
- **WHEN** the user focuses the not-started coordinator affordance
- **THEN** the main pane shows an empty state inviting the user to click Start to launch the orchestrator
- **AND** clicking Start launches the coordinator

### Requirement: Coordinated agents are attributed in the roster
Agents the coordinator spawns or drives are real panes and SHALL be surfaced in
the roster / overview with attribution to the specialist they were launched as
(when applicable) and to the coordinator that spawned them.

#### Scenario: Spawned specialist is attributed
- **WHEN** the coordinator spawns a pane as a specialist
- **THEN** that pane appears in the roster attributed to its specialist and to the coordinator that spawned it

#### Scenario: End-to-end orchestration is visible
- **WHEN** the user creates a specialist, starts the coordinator, and gives it a goal
- **THEN** the coordinator spawns that specialist as a visible pane, messages and reads it, and coordinates to completion
- **AND** the spawned pane and its attribution are visible in the roster
