## ADDED Requirements

### Requirement: PTY-Backed Process Spawning
The system SHALL spawn each pane as a real PTY via `portable-pty`'s `native_pty_system().openpty(PtySize{rows, cols, ..})`, run the configured program (`claude` or a shell) in a given `cwd` using `CommandBuilder`, seed the environment with `TERM=xterm-256color`, `COLORTERM=truecolor`, and `PATH`/`HOME`/`LANG`, and drop the PTY slave (`drop(pair.slave)`) immediately after `spawn_command` so the kernel will deliver EOF to the master reader.

#### Scenario: Spawn with seeded environment in target cwd
- **WHEN** a pane is created with a program path and a `cwd`
- **THEN** `openpty` is called with the pane's current `rows`/`cols` and `spawn_command` launches the program with working directory `cwd`
- **AND** the child process environment contains `TERM=xterm-256color`, `COLORTERM=truecolor`, and the inherited `PATH`, `HOME`, and `LANG` values (so `claude` is discoverable despite the sparse env macOS GUI apps inherit)

#### Scenario: Slave dropped so EOF is deliverable
- **WHEN** `spawn_command` returns successfully
- **THEN** the slave half of the PTY pair is dropped before the read loop begins, so that EOF is delivered on the master reader once the child exits and no slave fd remains

### Requirement: Lossless Ordered Output Streaming
The system SHALL stream PTY output to the frontend as raw, ordered bytes over a per-pane Tauri `Channel<T>` and SHALL NOT decode UTF-8 in Rust, so that xterm can reassemble split codepoints and escape sequences across chunk boundaries.

#### Scenario: Raw bytes forwarded in order over the channel
- **WHEN** the child process emits output to the PTY master
- **THEN** the dedicated read loop sends each chunk as `PtyEvent::Data{bytes}` (a `Vec<u8>`) over that pane's `Channel`, in read order, with no `from_utf8`/string conversion applied in Rust
- **AND** the frontend writes the payload via `term.write(new Uint8Array(bytes))`

#### Scenario: Split multibyte sequence reassembled by xterm
- **WHEN** a multibyte UTF-8 codepoint or ANSI escape sequence is split across two consecutive read chunks
- **THEN** each chunk is forwarded verbatim and xterm reassembles the original sequence, with no replacement characters or corrupted escape sequences introduced by the Rust side

### Requirement: Blocking Read Loop With Coalescing
The system SHALL run the PTY master read loop on a dedicated `std::thread` (never a tokio task, since a blocked `read` would starve the async runtime) and SHALL coalesce reads under bulk output (batching on roughly an 8-16ms cadence into 16-64KiB buffers) because there is no true backpressure to the PTY.

#### Scenario: Read loop runs on a native thread
- **WHEN** the read loop is started for a pane
- **THEN** it executes on a dedicated `std::thread` performing blocking reads, not on the tokio/async runtime

#### Scenario: Bulk output is batched
- **WHEN** the child emits a large burst of output faster than the UI consumes it
- **THEN** the read loop coalesces bytes into batched `PtyEvent::Data` sends (target ~8-16ms / 16-64KiB) rather than emitting one channel message per syscall

### Requirement: Input Forwarding To PTY
The system SHALL forward user input from xterm to the PTY via a `pty_write(id, Vec<u8>)` command, passing raw bytes to the PTY writer without decoding.

#### Scenario: Keystroke reaches the PTY writer
- **WHEN** the frontend's `term.onData` fires for the focused pane
- **THEN** `invoke('pty_write', { id, data })` is called and the Rust side writes the raw bytes to that pane's PTY writer (`MasterPty::take_writer`)

#### Scenario: Write to a nonexistent pane is rejected
- **WHEN** `pty_write` is invoked with an `id` that has no live pane
- **THEN** the command returns an error and does not panic or affect any other pane

### Requirement: PTY Resize Round-Trip
The system SHALL resize a pane's PTY via a `pty_resize(id, cols, rows)` command that calls `MasterPty::resize`, triggering `SIGWINCH` to the child, and the frontend SHALL drive resizes from a `ResizeObserver` through `addon-fit`'s `fit()` and `term.onResize`.

#### Scenario: Pane resize propagates new dimensions to the child
- **WHEN** a pane's container size changes and `fit()` recomputes cols/rows
- **THEN** `pty_resize(id, cols, rows)` calls `MasterPty::resize` with the new dimensions, delivering `SIGWINCH` so full-screen TUIs (e.g. `vim`, `htop`, Claude's TUI) reflow

#### Scenario: Fit guarded against zero-sized container
- **WHEN** the container reports a 0×0 size (e.g. hidden or mid-layout)
- **THEN** `fit()` is skipped and no resize with zero cols/rows is sent to the PTY

### Requirement: Child Exit Detection And Reaping
The system SHALL detect child exit by reading EOF on the PTY master, then call `child.wait()` to reap the process (macOS GUI parents do not auto-reap) and emit `PtyEvent::Exit{code}` to surface the exit to the UI.

#### Scenario: Exit code surfaced on child termination
- **WHEN** the child process exits and the read loop observes EOF
- **THEN** the system calls `child.wait()` to reap the child and emits `PtyEvent::Exit{code}` over that pane's channel with the process exit code

#### Scenario: Channel gone stops the read loop
- **WHEN** the per-pane channel is closed (e.g. the pane was torn down) while output is pending
- **THEN** the read loop detects the send failure and terminates instead of looping or panicking

### Requirement: Process Lifecycle And No Orphans
The system SHALL kill a pane's child process on pane close via `child.clone_killer()` / `ChildKiller::kill` (callable from another thread), and SHALL kill all pane processes on app quit (Tauri `CloseRequested`), reaping every child so that no zombie or orphan processes remain.

#### Scenario: Closing a pane kills its process
- **WHEN** a pane is closed in the UI
- **THEN** `pty_kill(id)` invokes the pane's cloned killer to terminate the child, and the child is reaped

#### Scenario: App quit reaps all children
- **WHEN** the window receives `CloseRequested`
- **THEN** every live pane's child process is killed and reaped before the app exits, leaving no zombie or orphan processes

### Requirement: WebGL Renderer With DOM Fallback
The system SHALL render each visible pane with the `@xterm/addon-webgl@0.19` renderer and SHALL fall back to xterm's DOM renderer on WebGL context loss, never installing or using `@xterm/addon-canvas` (removed in xterm 6), while keeping live WebGL contexts within the ~16-context-per-page ceiling by enabling WebGL only on visible panes.

#### Scenario: WebGL loaded for a visible pane
- **WHEN** a visible `TerminalPane` mounts and calls `term.open()`
- **THEN** it loads the WebGL addon for that terminal, and does not load `@xterm/addon-canvas`

#### Scenario: Context loss falls back to DOM
- **WHEN** the WebGL renderer fires `onContextLoss` for a pane
- **THEN** the system disposes the WebGL addon and the terminal continues rendering via the DOM renderer without losing scrollback

#### Scenario: WebGL restricted to stay under the context ceiling
- **WHEN** the number of panes that would otherwise hold a WebGL context approaches the ~16-per-page ceiling
- **THEN** WebGL is enabled only on visible panes (non-visible panes use the DOM renderer) so the live WebGL context count stays within the ceiling

### Requirement: Stable Terminal Identity Across Tree Mutations
The system SHALL key each `TerminalPane` on its stable `paneId` (`{#key paneId}`) and SHALL dispose terminal resources in order on teardown (`ResizeObserver.disconnect()` → `webgl.dispose()` → `term.dispose()` → close channel → `pty_kill`), so that split/close/reparent operations never remount xterm and never detach the still-running PTY.

#### Scenario: Reparenting does not remount the terminal
- **WHEN** a pane is split, closed elsewhere, or reparented within the pane tree without that pane's own `paneId` changing
- **THEN** its xterm instance is not remounted, scrollback is preserved, and its PTY remains attached

#### Scenario: Ordered teardown leaves no leaks
- **WHEN** a `TerminalPane` is destroyed (`onDestroy`)
- **THEN** the `ResizeObserver` is disconnected, the WebGL addon and terminal are disposed, the channel is closed, and `pty_kill` is called, leaving no leaked DOM nodes, listeners, or WebGL contexts
