## MODIFIED Requirements

### Requirement: Hook events are delivered over an app-hosted local socket

Every app-launched claude session SHALL deliver each hook lifecycle event as one
newline-terminated JSON line over an app-hosted **local socket** whose absolute
address is conveyed to the session in the `AGENT_DESKTOP_SOCKET_PATH` environment
variable.

The socket SHALL be a Unix-domain socket on macOS and Linux and a named pipe on
Windows. The address is opaque to the client: the event hook SHALL continue to
connect with Node's `net.createConnection({ path })` on every platform, with no
platform branching in the hook itself.

The hook SHALL tolerate an absent, unbindable, or unreachable socket without
blocking or failing the agent's turn, on every platform.

#### Scenario: Events flow on macOS and Linux

- **WHEN** a session emits a hook event on macOS or Linux
- **THEN** it is delivered over a Unix-domain socket at the filesystem path in
  `AGENT_DESKTOP_SOCKET_PATH`, exactly as before this change

#### Scenario: Events flow on Windows

- **WHEN** a session emits a hook event on Windows
- **THEN** it is delivered over a named pipe whose `\\.\pipe\…` name is carried in
  `AGENT_DESKTOP_SOCKET_PATH`
- **AND** the event is recorded to the per-pane ring and the durable
  `events/<sessionId>.jsonl` sink identically to the other platforms

#### Scenario: A stale address never blocks startup

- **WHEN** the app starts while an address from a previous run is still present
  (a leftover socket file on Unix, or a pipe name still held by a dying process on
  Windows)
- **THEN** the app still binds a usable socket and serves events, rather than
  failing to start the event server

#### Scenario: An absent socket does not block a turn

- **WHEN** the event socket cannot be reached from the hook on any platform
- **THEN** the hook exits without blocking, and the agent's turn proceeds normally

### Requirement: Hook and statusLine commands are invoked via `node`

The per-session `--settings` payload SHALL specify the event hook and statusLine
commands as an explicit `node "<absolute-path>"` invocation rather than as a bare
path to the script.

This removes any dependency on a `#!` shebang line or on the executable
permission bit, neither of which is honored on Windows. The same invocation form
SHALL be used on every platform so there is one code path.

#### Scenario: Hooks fire on Windows

- **WHEN** a session is launched on Windows
- **THEN** its configured hook command runs the installed `.cjs` through `node`
- **AND** hook events are delivered, so agent status derivation works rather than
  silently reporting nothing

#### Scenario: Hooks continue to fire on Unix

- **WHEN** a session is launched on macOS or Linux
- **THEN** its hook command runs through `node` and events are delivered exactly
  as before, with the script's executable bit no longer load-bearing
