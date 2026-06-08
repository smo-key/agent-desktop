## ADDED Requirements

### Requirement: Specialists are native project-scoped subagent files
A specialist SHALL be represented as a native Claude Code subagent file at project
scope: `.claude/agents/<name>.md`, with YAML frontmatter (`name`, `description`,
optional `tools`, optional `model`) and a markdown body that is the system prompt.
The file SHALL be the single source of truth; no parallel app-owned copy is kept.

#### Scenario: A specialist maps to its file
- **WHEN** a specialist named `<name>` exists for a project
- **THEN** it corresponds to `<project>/.claude/agents/<name>.md` with that frontmatter and body

#### Scenario: User-level agents are out of scope
- **WHEN** the user manages specialists
- **THEN** only project-scope `.claude/agents/*.md` files are read or written
- **AND** `~/.claude/agents` is not managed by this capability

### Requirement: Specialists panel lists the active project's specialists
The system SHALL provide a Specialists panel that lists the active project's
specialists by reading `.claude/agents/*.md`. When the project has no specialists,
the panel SHALL show an empty state.

#### Scenario: Listing existing specialists
- **WHEN** the active project has one or more `.claude/agents/*.md` files
- **THEN** the panel lists each specialist with its name and description

#### Scenario: Empty state
- **WHEN** the active project has no `.claude/agents/*.md` files
- **THEN** the panel shows an empty state inviting creation

### Requirement: Create, edit, and delete specialists via a form and prompt editor
The system SHALL let the user create, edit, and delete a specialist through a form
(name, description, model, tools) plus a prompt editor (the system-prompt body),
serializing to and deserializing from the `.claude/agents/<name>.md` file.

#### Scenario: Creating a specialist
- **WHEN** the user fills the form and prompt editor and saves a new specialist
- **THEN** the system writes a `.claude/agents/<name>.md` file with the corresponding frontmatter and body
- **AND** the new specialist appears in the panel

#### Scenario: Editing a specialist
- **WHEN** the user edits an existing specialist and saves
- **THEN** the system rewrites its `.claude/agents/<name>.md` with the updated frontmatter and body

#### Scenario: Deleting a specialist
- **WHEN** the user deletes a specialist
- **THEN** the system removes its `.claude/agents/<name>.md` file
- **AND** the specialist no longer appears in the panel

### Requirement: Specialist names are validated before write
The system SHALL require a specialist `name` to be unique within the project and
filename-safe before writing its file. A malformed or unreadable `.md` file SHALL
surface as a read error for that entry without breaking the panel.

#### Scenario: Duplicate or unsafe name is rejected
- **WHEN** the user attempts to save a specialist whose name duplicates an existing one or is not filename-safe
- **THEN** the save is rejected with a validation message and no file is written

#### Scenario: Malformed file does not break the panel
- **WHEN** a `.claude/agents/*.md` file cannot be parsed
- **THEN** that entry surfaces as a read error
- **AND** the other specialists still list normally

### Requirement: Spawn a pane as a specialist
The orchestration runtime's `spawn_agent` SHALL accept an optional specialist
reference. When given, the launched `claude` pane SHALL be composed from that
specialist file — applying its system prompt, and its model and tool scoping when
present — and the spawned pane SHALL record the specialist it was launched as.

#### Scenario: Spawning as a specialist applies its definition
- **WHEN** `spawn_agent` is called with a specialist reference
- **THEN** the launched `claude` pane is configured with that specialist's system prompt (and its model / tools when present)

#### Scenario: Spawned pane records its specialist
- **WHEN** a pane is spawned as a specialist
- **THEN** the pane records which specialist it was launched as, so it can be attributed in the roster
