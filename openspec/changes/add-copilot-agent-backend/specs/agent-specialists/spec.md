## MODIFIED Requirements

### Requirement: Spawn a pane as a specialist
The orchestration runtime's `spawn_agent` SHALL accept an optional specialist
reference. When given, the launched agent pane SHALL be composed from that
specialist file — applying its system prompt, and its model and tool scoping when
present — and the spawned pane SHALL record the specialist it was launched as.

For a `claude` pane this composition uses Claude CLI flags as today. For a
`copilot` pane, WHEN the Copilot backend declares specialist support, the
specialist SHALL be translated at launch into a Copilot custom agent (persona
body carried in the generated agent definition, frontmatter `model` mapped to
`--model`, frontmatter `tools` mapped to Copilot tool scoping) and launched via
`--agent`. WHEN the Copilot backend does not declare specialist support, the
specialist launch surface SHALL present Copilot specialist launches as
unavailable ("Claude only") rather than launching an unconfigured pane.

#### Scenario: Spawning as a specialist applies its definition
- **WHEN** `spawn_agent` is called with a specialist reference for a `claude` pane
- **THEN** the launched `claude` pane is configured with that specialist's system prompt (and its model / tools when present)

#### Scenario: Spawned pane records its specialist
- **WHEN** a pane is spawned as a specialist
- **THEN** the pane records which specialist it was launched as, so it can be attributed in the roster

#### Scenario: Copilot specialist launch via translated custom agent
- **WHEN** a specialist is launched on the Copilot backend and Copilot declares specialist support
- **THEN** a Copilot custom agent is generated from the specialist file and the pane launches with `--agent <name>` plus the mapped model and tool scoping, and the pane records its specialist

#### Scenario: Declared degradation when translation is unsupported
- **WHEN** a specialist launch is requested on the Copilot backend and Copilot does not declare specialist support
- **THEN** the launch is refused with a visible "Claude only" indication instead of spawning a pane without the specialist's configuration
