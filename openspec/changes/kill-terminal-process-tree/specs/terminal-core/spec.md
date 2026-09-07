## MODIFIED Requirements

### Requirement: Process Lifecycle And No Orphans
The system SHALL terminate a pane's entire process tree on pane close — the direct child plus every descendant, including processes that ignore SIGHUP or run in a different process group — and SHALL do the same for every live pane on app quit (Tauri `CloseRequested`), reaping each direct child so that no zombie or orphan processes remain. Termination SHALL escalate: hangup/terminate signals first, a short grace period, then a forced kill of any survivor found by re-walking the tree.

#### Scenario: Closing a pane kills its process
- **WHEN** a pane is closed in the UI
- **THEN** `pty_kill(id)` terminates the pane's child process, and the child is reaped

#### Scenario: Closing a pane kills descendants that ignore hangup
- **WHEN** a pane is closed while its child has spawned a grandchild that ignores SIGHUP (e.g. via `nohup`)
- **THEN** the grandchild is terminated as well, and the direct child is reaped

#### Scenario: Closing a pane kills a child that traps hangup
- **WHEN** a pane is closed while its direct child (and what it spawned) ignores SIGHUP
- **THEN** the child and its descendants are still terminated — forcibly after the grace period if necessary — and the child is reaped

#### Scenario: App quit reaps all children
- **WHEN** the window receives `CloseRequested`
- **THEN** every live pane's child process is killed and reaped before the app exits, leaving no zombie or orphan processes

#### Scenario: App quit kills descendants that ignore hangup
- **WHEN** the window receives `CloseRequested` while a pane's child has spawned a grandchild that ignores SIGHUP
- **THEN** `kill_all` returns only after that grandchild is gone, and the pane's child is reaped
