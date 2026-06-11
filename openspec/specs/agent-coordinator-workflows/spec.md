# agent-coordinator-workflows Specification

## Purpose
TBD - created by archiving change add-agent-specialists. Update Purpose after archive.
## Requirements
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
it. Its row SHALL always be labeled "Coordinator" — whether running or not — and
SHALL NOT carry a role or "not started" badge. The coordinator SHALL be shown for
the active project even when there are no other sessions; in that case the "No
sessions yet" empty state SHALL render below the coordinator and its rule. When
the active project has no running coordinator, the top row SHALL be a focusable
affordance (still labeled "Coordinator"); focusing it SHALL show an empty
main-pane state inviting the user to click a Start button to launch the
orchestrator, and clicking Start SHALL launch the coordinator. When the
coordinator is focused, the focus-pane header SHALL also read "Coordinator"
(matching its pinned row), NOT its underlying workspace name ("Session N").

#### Scenario: Running coordinator is pinned at the top
- **WHEN** a project has a running coordinator
- **THEN** the coordinator appears at the top of the Sessions list above all other sessions, labeled "Coordinator" with no role/"not started" badge
- **AND** a horizontal rule separates it from the remaining sessions
- **AND** there is no separate heading for it

#### Scenario: Coordinator shown with no other sessions
- **WHEN** the active project has no sessions other than the coordinator
- **THEN** the coordinator row (and its rule) still appears at the top
- **AND** the "No sessions yet" empty state renders below it

#### Scenario: Affordance shown when no coordinator
- **WHEN** the active project has no running coordinator
- **THEN** a focusable row labeled "Coordinator" appears at the top of the Sessions list

#### Scenario: Focus-pane header reads "Coordinator"
- **WHEN** the running coordinator is the focused agent
- **THEN** the focus-pane header title reads "Coordinator"
- **AND** it does NOT show the coordinator's underlying workspace name ("Session N")

#### Scenario: Focusing the not-started coordinator shows a Start prompt
- **WHEN** the user focuses the not-started coordinator row
- **THEN** the main pane shows an empty state inviting the user to click Start to launch the orchestrator
- **AND** clicking Start launches the coordinator

#### Scenario: No Start coordinator entry in the project context menu
- **WHEN** the user opens a project's context menu
- **THEN** it does not contain a "Start coordinator" entry (the coordinator is started from the Sessions list)

### Requirement: Coordinator is included in session cycling
The ⌘↑ / ⌘↓ session-cycling SHALL include the coordinator — its running row, or,
when not started, its top-slot affordance — so the user can focus it via the
keyboard, including when it is the only entry in the Sessions list.

#### Scenario: Cycling reaches the coordinator
- **WHEN** the user presses ⌘↑ or ⌘↓ to cycle sessions
- **THEN** the cycle includes the coordinator (its running row, or the not-started affordance)

#### Scenario: Cycling works when the coordinator is the only entry
- **WHEN** the coordinator (or its not-started affordance) is the only entry in the Sessions list
- **THEN** ⌘↑ / ⌘↓ still focuses it

### Requirement: Coordinator cannot be paused or archived, only deleted
The user SHALL NOT be able to pause or archive the coordinator. The coordinator
SHALL be deletable. (This complements the toolkit's rejection of `archive_agent` /
`unarchive_agent` targeting a coordinator pane.)

#### Scenario: Pause and archive are not offered for the coordinator
- **WHEN** the user views the coordinator's available actions
- **THEN** pause and archive actions are not offered for it

#### Scenario: Coordinator can be deleted
- **WHEN** the user deletes the coordinator
- **THEN** the coordinator is removed

### Requirement: Coordinator surfaces needs-input only on explicit signal
The coordinator SHALL NOT be shown as needing input by the default activity
heuristic. It SHALL be shown as needing input ONLY when it asks the user a
question via the AskUserQuestion tool, or when it calls a dedicated needs-input
tool. The coordinator's context SHALL instruct it that when it needs user input
without asking a question via AskUserQuestion, it MUST call the needs-input tool.
When that tool is called, the user SHALL see that the coordinator needs input;
the indication SHALL clear once the coordinator resumes.

#### Scenario: Idle coordinator is not flagged as needing input
- **WHEN** the coordinator is idle or waiting but has neither asked a question via AskUserQuestion nor called the needs-input tool
- **THEN** it is not shown as needing input

#### Scenario: AskUserQuestion shows needs-input
- **WHEN** the coordinator asks the user a question via the AskUserQuestion tool
- **THEN** it is shown as needing input

#### Scenario: Needs-input tool shows needs-input
- **WHEN** the coordinator calls the needs-input tool
- **THEN** the user sees that the coordinator needs input
- **AND** the indication clears once the coordinator resumes

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

