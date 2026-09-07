## MODIFIED Requirements

### Requirement: Process Lifecycle And No Orphans
The system SHALL terminate a pane's entire process tree on pane close — the direct child plus every descendant, including processes that ignore SIGHUP or run in a different process group — and SHALL do the same for every live pane on app quit (Tauri `CloseRequested`), reaping each direct child so that no zombie or orphan processes remain. Termination SHALL escalate: hangup/terminate signals first, a short grace period, then a forced kill of any survivor found by re-walking the tree. The tree's members and their process groups SHALL be recorded, and the graceful signals sent, before the pane's PTY is released, so jobs an exiting shell leaves behind are still found. A child the read loop has already reaped SHALL NOT be signalled again (its pid may have been recycled).

#### Scenario: Closing a pane kills its process
- **WHEN** a pane is closed in the UI
- **THEN** `pty_kill(id)` terminates the pane's child process, and the child is reaped

#### Scenario: Closing a pane kills descendants that ignore hangup
- **WHEN** a pane is closed while its child has spawned a grandchild that ignores SIGHUP (e.g. via `nohup`)
- **THEN** the grandchild is terminated as well, and the direct child is reaped

#### Scenario: Closing a pane kills a child that traps hangup
- **WHEN** a pane is closed while its direct child (and what it spawned) ignores SIGHUP
- **THEN** the child and its descendants are still terminated — forcibly after the grace period if necessary — and the child is reaped

#### Scenario: Closing a pane force-kills a job in its own process group
- **WHEN** a pane is closed while its child runs a job under job control (own process group) that ignores both SIGTERM and SIGHUP, and the child itself exits on hangup
- **THEN** the job is still force-killed after the grace period even though it was reparented to init, and the child is reaped

#### Scenario: Closing a pane kills an interactive shell's background jobs
- **WHEN** a pane running an interactive shell with a background job is closed
- **THEN** the job is terminated along with the shell, and the shell is reaped

#### Scenario: App quit reaps all children
- **WHEN** the window receives `CloseRequested`
- **THEN** every live pane's child process is killed and reaped before the app exits, leaving no zombie or orphan processes

#### Scenario: App quit kills descendants that ignore hangup
- **WHEN** the window receives `CloseRequested` while a pane's child has spawned a grandchild that ignores SIGHUP
- **THEN** `kill_all` returns only after that grandchild is gone, and the pane's child is reaped
