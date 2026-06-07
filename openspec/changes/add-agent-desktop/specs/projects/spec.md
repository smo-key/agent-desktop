## ADDED Requirements

### Requirement: Project Model And Assignment
The system SHALL model a PROJECT as a working folder with a human-readable name, color, and icon, and SHALL bind an agent to a project EXPLICITLY at launch — recording the chosen project's id on the pane's session registry entry (and persisting it) — never inferring it.

#### Scenario: Project assigned at launch
- **WHEN** a session is launched under a chosen project
- **THEN** the launch plan carries that project's id (verbatim; a blank/missing id is omitted) and the project's folder as the working directory
- **AND** the new pane's registry entry records the project id so the binding survives a restart

#### Scenario: Agent carries its project identity
- **WHEN** the overview roster is built
- **THEN** each agent row carries the project id from its registry entry (or null when the pane was not launched under a project)

### Requirement: Project Creation And Persistence
The system SHALL let the user create a project (name + folder + icon/color), persist the project list independently of the layout (a sibling `projects.json`, atomic tmp+rename), and tolerate a missing/malformed file as an empty list. Re-using a folder updates the existing project in place rather than duplicating it.

#### Scenario: Creating a project adds it to the head, deduped by folder
- **WHEN** a project is created (or re-created for a folder that already has one)
- **THEN** it is placed at the head of the list, an existing project for the same folder is replaced in place (keeping its id so bound agents stay valid), and a blank-path project is ignored

### Requirement: Filter The Fleet By Project
The system SHALL provide a project panel (shared by both overviews) that filters the agent roster by project, showing each project's live agent count and an attention indicator when any of its agents needs the user, plus an "All agents" option and a bucket for unassigned agents.

#### Scenario: Filter agents by project
- **WHEN** a project (or "All agents", or the unassigned bucket) is selected in the panel
- **THEN** the roster is filtered to the agents bound to that selection
- **AND** the panel shows each project's agent count and flags a project whose agents are waiting/errored
