# agent-overview Specification

## Purpose
TBD - created by archiving change add-agent-desktop. Update Purpose after archive.
## Requirements
### Requirement: Agent Inbox Overview

The overview SHALL present every agent as an inbox: a grouped roster (Needs you /
In flight / Completed) on the left, and a single focus pane on the right that shows
the selected agent's live terminal. The focus pane SHALL auto-fill from the
attention queue, advance to the next when the focused agent is addressed, and show
an "All clear" state when nothing needs the user and nothing is selected.

#### Scenario: Attention queue surfaces waiting and errored agents

- **WHEN** the roster contains working, waiting, finished, and errored agents
- **THEN** the attention queue lists only the waiting and errored agents, in roster order

#### Scenario: Focus resolves to the user selection before the queue

- **WHEN** the user has selected an agent that still exists in the roster
- **THEN** the focus pane shows that agent, not the head of the attention queue

#### Scenario: Focus falls back to the attention queue when nothing is selected

- **WHEN** no agent is selected
- **THEN** the focus pane shows the first agent in the attention queue

#### Scenario: Focus is empty when nothing needs attention and nothing is selected

- **WHEN** no agent needs attention and none is selected
- **THEN** the focus pane shows the "All clear" state

#### Scenario: Addressed attention agent advances the focus to the next

- **WHEN** the focused attention agent transitions out of needing attention
- **THEN** the focus advances to the next agent in the attention queue

#### Scenario: Queue navigation steps through waiting agents

- **WHEN** the user steps the focus header's queue navigation
- **THEN** the focus moves to the next or previous agent in the attention queue, wrapping at the ends

#### Scenario: Entering an agent focuses its terminal and scrolls to the bottom

- **WHEN** an agent becomes the focused one in the inbox
- **THEN** its live terminal is focused and scrolled to the bottom

#### Scenario: The live surface is teleported into the focus pane without respawning

- **WHEN** an agent is shown in the focus pane and then expanded to the grid
- **THEN** the same live terminal session is used throughout, with no PTY respawn

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

Because the assistant turn carrying an `AskUserQuestion` is NOT written to the transcript until the question is answered (it flushes only once the tool resolves), a PENDING question cannot be read from the transcript. The system SHALL therefore source a pending question from the activity-event pipeline: the `PreToolUse[AskUserQuestion]` hook event carries the structured question payload, which the frontend surfaces as the agent's pending `question` and structured `questions`, clearing it on the matching `PostToolUse`/`Stop` (see the `activity-timeline` capability). This supersedes the earlier `<uuid>.question.json` sidecar written by a dedicated question hook and read back by the transcript reader — both now retired. The system SHALL also disable the cloud Remote-Control bridge per session (`remoteControlAtStartup: false`) so the transcript stays local and complete.

#### Scenario: Agent launched with an app-owned session id
- **WHEN** a `claude` pane is spawned
- **THEN** its args carry `--session-id <uuid>` (a fresh app-generated id, before the statusline `--settings` override), and that id — not the snapshot — is what the overview uses to read the agent's exact transcript; a shell pane gets no session id

#### Scenario: Last assistant message becomes the summary
- **WHEN** the activity reader parses a transcript whose newest assistant turn contains a text block (possibly followed by tool uses)
- **THEN** that text (whitespace collapsed, truncated) becomes the agent's `summary`, shown on the card/window as "what it just said"

#### Scenario: Pending question surfaces from the transcript
- **WHEN** an agent's latest turn used the `AskUserQuestion` tool and no later tool result has answered it
- **THEN** the agent's `question` is the question text and is shown prominently on the card/window; once a tool result answers it, the question clears

#### Scenario: Answer a pending question from the overview
- **WHEN** an agent's card shows a pending question's options and the user clicks an option, or types their own answer
- **THEN** the app drives the agent's live menu over the PTY — selecting the chosen option (cursor-down to it, Enter), or navigating to the "type something" entry and sending the user's verbatim text — and never synthesizes an answer the user did not give (a blank free-text answer sends nothing)

### Requirement: Resume An Archived Session By Selecting It

Selecting an archived (closed) agent in the roster SHALL re-open it for viewing by
respawning `claude --resume <sessionId>`, so its prior transcript is shown in the
focus pane and is immediately interactive. The session SHALL remain presented as
archived — in the Archived lane and out of the attention queue — until the user
commits to it by sending a new message, at which point it is unarchived and rejoins
its live status lane. This replaces the previous behavior, where selecting an
archived session showed a static panel that required an explicit "Restore" click;
the system SHALL NOT show that intermediate restore panel.

A session that is being previewed but to which no message has yet been sent SHALL be
returned to its archived state — its resumed PTY terminated — once the user has not
been on its window for a grace period, so previewing does not leak idle resumed
processes. A previewing session's preview state is runtime-only: it SHALL persist as
archived, so an app restart never restores it as live.

An archived session that cannot be resumed (not a `claude` session, or it has no
app-owned session id) SHALL simply be selected as before, with no resume attempt.

#### Scenario: Selecting an archived resumable session resumes it for preview
- **WHEN** the user selects an archived `claude` agent that has an app-owned session id
- **THEN** the system respawns it with `claude --resume <sessionId>`, shows its transcript in the focus pane, focuses its terminal, and no static "Session archived" restore panel is shown

#### Scenario: A previewing session stays archived and out of attention
- **WHEN** an archived session has been resumed for preview but no new message has been sent
- **THEN** its roster row remains in the Archived lane and is excluded from the attention queue, even while its resumed terminal is live

#### Scenario: Sending a message unarchives a previewing session
- **WHEN** the user sends a new message to a previewing session (its user-message hash changes from the hash captured when preview began)
- **THEN** the session is unarchived and rejoins its live status lane (In flight / Needs you), and is no longer treated as archived

#### Scenario: Leaving a previewing session re-archives it after the grace period
- **WHEN** the user stops being on a previewing session's window and does not return within the grace period, without having sent a message
- **THEN** the resumed PTY is terminated and the session returns to its archived state, restorable again by re-selecting it

#### Scenario: A previewing session persists as archived
- **WHEN** the persisted layout is serialized while a session is being previewed
- **THEN** that session is written as archived (closed, not resuming), so an app restart restores it as an archived session rather than a live one

#### Scenario: A non-resumable archived session is just selected
- **WHEN** the user selects an archived agent that is not a resumable `claude` session
- **THEN** the row is selected without any resume attempt and without a restore panel

