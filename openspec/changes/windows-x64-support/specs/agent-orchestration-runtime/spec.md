## MODIFIED Requirements

### Requirement: The orchestration control transport is a cross-platform local socket

The Rust control transport SHALL be an app-hosted **local socket** that carries an
orchestrator's MCP toolkit calls to the frontend executor, and whose absolute
address is exported to a launched coordinator session in the
`AGENT_DESKTOP_CONTROL_SOCKET` environment variable.

The socket SHALL be a Unix-domain socket on macOS and Linux and a named pipe on
Windows. The bundled MCP adapter SHALL continue to connect with Node's
`net.createConnection({ path })` on every platform, with no platform branching in
the adapter.

The request/response contract over that transport is UNCHANGED: one JSON request
per connection, a Rust-assigned request id, emission to the frontend, a bounded
wait for the matching reply, and the JSON response written back over the same
connection.

#### Scenario: A toolkit call round-trips on Windows

- **WHEN** a coordinator's MCP toolkit issues a control op on Windows
- **THEN** the request is accepted over the named pipe, dispatched to the frontend
  executor, and its reply written back over the same connection
- **AND** the result is indistinguishable from the same op on macOS

#### Scenario: Per-target serialization and timeout are preserved

- **WHEN** two ops targeting the SAME agent pane arrive concurrently on any
  platform
- **THEN** they are serialized against each other, while ops with no target or
  different targets still proceed concurrently
- **AND** a request with no reply within the request timeout still receives a
  `{ id, error: "timeout" }` response

#### Scenario: Control socket binds cleanly after an unclean exit

- **WHEN** the app restarts after a crash that left the previous control-socket
  address behind
- **THEN** the control socket binds successfully and orchestration works, rather
  than failing to start
