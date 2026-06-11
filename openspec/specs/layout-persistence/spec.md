# layout-persistence Specification

## Purpose
TBD - created by archiving change add-agent-desktop. Update Purpose after archive.
## Requirements
### Requirement: Serialize Workspace Layout And Session Registry
The system SHALL serialize every workspace as a `Workspace{version, root, focusedId}` pane tree plus a session registry mapping each `paneId` to `{cwd, shell}`, encoded as JSON written to a layout file under the application support directory.

#### Scenario: Layout tree and registry serialized to JSON
- **WHEN** the persistence layer serializes the current state
- **THEN** the written JSON contains a `version` field, the recursive `root` node (Leaf/Split with `direction`, `children`, and `ratios`), and `focusedId`
- **AND** it contains a session registry entry `{cwd, shell}` for every `paneId` referenced by a Leaf in the tree

#### Scenario: Live process state is not serialized
- **WHEN** a pane is running a `claude` process or any other command at serialization time
- **THEN** the serialized session-registry entry for that pane records only `cwd` and `shell` and records no process id, command arguments, or in-flight output

### Requirement: Debounced And On-Quit Persistence Writes
The system SHALL debounce layout writes so rapid successive mutations coalesce into a single write, and SHALL additionally force a synchronous flush of pending state when the application receives a close/quit request.

#### Scenario: Rapid mutations coalesce into one write
- **WHEN** multiple tree mutations (split, close, resize, focus) occur within the debounce interval
- **THEN** only a single JSON write to the layout file is performed after the interval elapses, reflecting the final state

#### Scenario: Pending state flushed on quit
- **WHEN** the application receives a `CloseRequested`/quit event while a debounced write is still pending
- **THEN** the persistence layer flushes the latest workspace and session registry to the layout file before the process exits

### Requirement: Restore With Invariant Validation
The system SHALL restore saved layouts by parsing the layout JSON and running `validateTree()`, which re-asserts that for every Split `ratios.length === children.length` and the ratios normalize to a sum of approximately 1, that every Split has at least 2 children, and that `focusedId` references an existing Leaf in the tree.

#### Scenario: Valid layout restored
- **WHEN** the layout file parses and `validateTree()` passes all invariants
- **THEN** the workspace pane trees are rebuilt from the saved `root` and `focusedId` is applied as the focused leaf

#### Scenario: Ratios normalized on restore
- **WHEN** a restored Split has `ratios` that do not sum to exactly 1 but are otherwise structurally valid
- **THEN** `validateTree()` normalizes the ratios to sum to approximately 1 before the tree is rebuilt

#### Scenario: Invariant violation is treated as invalid
- **WHEN** a restored Split has fewer than 2 children, or `focusedId` does not reference an existing Leaf
- **THEN** `validateTree()` rejects the layout as invalid and restore does not rebuild the corrupt tree

### Requirement: Version-Keyed Migration
The system SHALL run version-keyed migrations against the parsed `version` field during restore so that layouts written by older schema versions are upgraded to the current schema before `validateTree()` rebuilds the tree.

#### Scenario: Older version migrated forward
- **WHEN** a layout file declares a `version` older than the current schema version
- **THEN** the matching migration(s) run in sequence to transform the parsed structure up to the current `version` before validation and rebuild

#### Scenario: Unmigratable version is rejected
- **WHEN** the parsed `version` has no applicable migration path to the current schema version
- **THEN** the layout is treated as unmigratable and restore does not rebuild from it

### Requirement: PTY Re-Spawn With Shell And Cwd Only
The system SHALL, on restore, re-spawn a fresh PTY for each Leaf using only the saved `shell` and `cwd` from the session registry, with tmux-resurrect semantics in which previous live process state is not restored.

#### Scenario: One PTY re-spawned per leaf
- **WHEN** a validated tree is rebuilt on launch
- **THEN** exactly one PTY is spawned per Leaf, each using the `cwd` and `shell` recorded for that Leaf's `paneId` in the session registry

#### Scenario: Live process state not resurrected
- **WHEN** a pane's prior session had been running `claude` or another long-lived process before the previous quit
- **THEN** the re-spawned PTY starts the saved `shell` in the saved `cwd` and does not re-attach to or re-run the prior process

### Requirement: Optional Scrollback Repaint
The system SHALL optionally repaint saved xterm scrollback for a restored pane via the `addon-serialize` output before the re-spawned PTY is reattached, and SHALL restore the pane without scrollback when no serialized buffer is available.

#### Scenario: Scrollback repainted before reattach
- **WHEN** a restored pane has a saved `addon-serialize` scrollback buffer
- **THEN** the buffer is written into the xterm instance to repaint prior output before the new PTY's data is attached

#### Scenario: Missing scrollback does not block restore
- **WHEN** a restored pane has no saved scrollback buffer
- **THEN** the pane is still restored with its re-spawned PTY and only lacks the repainted history

### Requirement: Graceful Fallback On Corrupt State
The system SHALL fall back to a fresh single-pane workspace rather than crashing whenever the layout file is missing, fails to parse as JSON, fails `validateTree()`, or is unmigratable.

#### Scenario: Corrupt JSON falls back to fresh workspace
- **WHEN** the layout file exists but `JSON.parse` throws or `validateTree()` rejects the structure
- **THEN** the application launches with a fresh single-pane workspace (one Leaf, `focusedId` set to that leaf) instead of crashing

#### Scenario: Missing layout file falls back to fresh workspace
- **WHEN** no layout file exists in the application support directory at launch
- **THEN** the application launches with a fresh single-pane workspace

