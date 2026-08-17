## REMOVED Requirements

### Requirement: One coordinator per project, started on demand
**Reason**: The coordinator feature is removed from the product by owner
decision; it has not earned its complexity.
**Migration**: Launch and manage agent sessions directly from the launcher and
project surfaces. The orchestration runtime and specialists remain available.

### Requirement: Coordinator is a claude pane with the toolkit attached
**Reason**: Coordinator feature removed.
**Migration**: None — the MCP toolkit and control socket remain for agent panes that mount them.

### Requirement: Coordinator persists and is reused for the session
**Reason**: Coordinator feature removed.
**Migration**: None.

### Requirement: Coordinator runs dynamic workflows over specialists and existing sessions
**Reason**: Coordinator feature removed.
**Migration**: Specialists can still be spawned directly via the orchestration runtime's `spawn_agent`.

### Requirement: Coordinator delegates all work and cannot perform it directly
**Reason**: Coordinator feature removed.
**Migration**: None.

### Requirement: Coordinator is pinned to the top of the Sessions list
**Reason**: Coordinator feature removed.
**Migration**: None — the Sessions list orders ordinary sessions only.

### Requirement: Coordinator is included in session cycling
**Reason**: Coordinator feature removed.
**Migration**: None — session cycling covers ordinary sessions.

### Requirement: Coordinator cannot be paused or archived, only deleted
**Reason**: Coordinator feature removed.
**Migration**: None.

### Requirement: Coordinator surfaces needs-input only on explicit signal
**Reason**: Coordinator feature removed.
**Migration**: None — ordinary panes keep their existing needs-input derivation.

### Requirement: Coordinated agents are attributed in the roster
**Reason**: Coordinator feature removed.
**Migration**: Panes spawned as specialists still record and display their specialist attribution.
