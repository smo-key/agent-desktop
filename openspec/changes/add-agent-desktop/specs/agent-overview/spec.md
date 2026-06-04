## ADDED Requirements

### Requirement: Agent Roster Overview
The system SHALL provide an Overview surface that lists every running agent (each terminal pane running a Claude session) with its name/cwd, model, current task, context percentage, cost (from the agent's latest usage snapshot), and a working/needs-input/finished/errored status derived from the agent's live terminal activity and process state.

#### Scenario: Roster reflects running agents
- **WHEN** the overview is shown and one or more panes are running Claude sessions
- **THEN** it lists one entry per agent showing that agent's model, current task (the in-progress `activeForm`), context percentage, and cost taken from its latest snapshot

#### Scenario: Agent status reflects working, waiting, finished, and errored
- **WHEN** an agent's terminal produced output within the working window (claude is streaming)
- **THEN** its status is `working`
- **AND** when it is alive but its terminal has been quiet past the working window its status is `waiting` (needs the user's input)
- **AND** when its process has exited with a zero/unknown code its status is `finished`
- **AND** when its process has exited with a non-zero code its status is `error`

### Requirement: Navigate To An Agent
The system SHALL let the user open an agent from the overview, switching to the terminal grid with that agent's workspace active and its pane focused.

#### Scenario: Selecting an agent focuses its pane
- **WHEN** the user activates an agent entry in the overview
- **THEN** the app switches to the terminal-grid view, activates that agent's workspace, and focuses that agent's pane

### Requirement: Message An Agent
The system SHALL let the user send text to any agent's terminal from the overview without navigating to its pane, delivering the exact text to that agent's PTY.

#### Scenario: Sending a message writes to the agent PTY
- **WHEN** the user submits a message for an agent from the overview
- **THEN** the exact text followed by a single carriage return is written to that agent's PTY via the existing terminal write path

#### Scenario: Only user-entered text is ever sent
- **WHEN** the app delivers any input to an agent (an overview message or a launch-time initial prompt)
- **THEN** it transmits only text the user entered and never synthesizes a slash command or other input on the user's behalf

### Requirement: Kick Off A New Agent From The Overview
The system SHALL provide a "new agent" action in the overview that opens the session launcher, and the agent created through it SHALL appear in the overview roster.

#### Scenario: New-agent action launches and rosters
- **WHEN** the user triggers "new agent" in the overview and completes the launcher
- **THEN** a new Claude session starts in the chosen folder and a corresponding agent entry appears in the overview roster

### Requirement: Surface Subagents
The system SHALL surface subagents that an app agent spawns (Task-tool agents and workflow agents) under their parent agent, read from the parent session's workflow run records and per-subagent metadata under `~/.claude/projects/<project>/<session>/`, and SHALL tolerate absent or partial metadata.

#### Scenario: Subagents appear under their parent agent
- **WHEN** an app agent's session has spawned subagents recorded under its project session directory (`workflows/<id>.json` and `subagents/**/agent-*.meta.json`)
- **THEN** each subagent is listed under that parent agent with its label and status

#### Scenario: Partial subagent metadata does not break the roster
- **WHEN** a subagent metadata record is missing fields or is malformed
- **THEN** that record is skipped or shown with only its available fields, and the rest of the roster is unaffected

### Requirement: Agent Usage Tracking
The system SHALL track usage per agent (cost, context percentage, and token counts where available) and SHALL show an aggregate usage total across all agents and their subagents.

#### Scenario: Per-agent usage reflects the snapshot
- **WHEN** an agent has a latest snapshot
- **THEN** its displayed usage reflects that snapshot's cost and context percentage

#### Scenario: Aggregate usage sums agents and subagents
- **WHEN** the overview computes the usage total
- **THEN** it sums each agent's cost together with each available subagent's recorded usage, ignoring records whose usage is unavailable

### Requirement: Overview As A Primary View
The system SHALL present the card overview as the primary top-level view, which the user can switch to and from the terminal grid.

#### Scenario: Switch between the overview and grid views
- **WHEN** the user switches the top-level view
- **THEN** the view toggles between the card overview and the terminal grid
- **AND** choosing an agent from the overview lands on the grid focused on that agent

### Requirement: Live Transcript Activity
The system SHALL spawn each `claude` agent with an APP-OWNED session id (`--session-id <uuid>`) and derive that agent's high-level activity directly from its EXACT session TRANSCRIPT (`~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`), so the overview surfaces the agent's last message and any pending question INDEPENDENTLY of the statusline snapshot — which does not re-render while Claude is blocked on an interactive `AskUserQuestion` prompt — and never cross-contaminates two agents that share a folder. The frontend SHALL poll this per-pane `{summary, question}` on a short clock.

Because the assistant turn carrying an `AskUserQuestion` is NOT written to the transcript until the question is answered (it flushes only once the tool resolves), a PENDING question cannot be read from the transcript. The system SHALL therefore install an `AskUserQuestion` hook into each agent's per-session `--settings` that, on `PreToolUse`, writes the question text to a `<uuid>.question.json` sidecar beside the transcript, and on `PostToolUse`/`Stop` clears it; the activity reader SHALL use that sidecar as the agent's pending `question`. The system SHALL also disable the cloud Remote-Control bridge per session (`remoteControlAtStartup: false`) so the transcript stays local and complete.

#### Scenario: Agent launched with an app-owned session id
- **WHEN** a `claude` pane is spawned
- **THEN** its args carry `--session-id <uuid>` (a fresh app-generated id, before the statusline `--settings` override), and that id — not the snapshot — is what the overview uses to read the agent's exact transcript; a shell pane gets no session id

#### Scenario: Last assistant message becomes the summary
- **WHEN** the activity reader parses a transcript whose newest assistant turn contains a text block (possibly followed by tool uses)
- **THEN** that text (whitespace collapsed, truncated) becomes the agent's `summary`, shown on the card/window as "what it just said"

#### Scenario: Pending question surfaces from the transcript
- **WHEN** an agent's latest turn used the `AskUserQuestion` tool and no later tool result has answered it
- **THEN** the agent's `question` is the question text and is shown prominently on the card/window; once a tool result answers it, the question clears

#### Scenario: Pending question comes from the sidecar
- **WHEN** an agent is blocked on an `AskUserQuestion` whose assistant turn is not yet in the transcript, and the hook has written `<uuid>.question.json` beside the transcript
- **THEN** the activity reader uses that sidecar's text as the agent's pending `question`, AND surfaces the structured `questions` (each with its header, prompt, multi-select flag, and selectable options); when the sidecar is removed (the hook's clear-on-answer), both clear

#### Scenario: Answer a pending question from the overview
- **WHEN** an agent's card shows a pending question's options and the user clicks an option, or types their own answer
- **THEN** the app drives the agent's live menu over the PTY — selecting the chosen option (cursor-down to it, Enter), or navigating to the "type something" entry and sending the user's verbatim text — and never synthesizes an answer the user did not give (a blank free-text answer sends nothing)
