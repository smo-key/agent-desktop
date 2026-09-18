## MODIFIED Requirements

### Requirement: Lossless Ordered Output Streaming
The system SHALL stream PTY output to the frontend as raw, ordered bytes over a per-pane Tauri `Channel<T>` and SHALL NOT decode UTF-8 in Rust, so that xterm can reassemble split codepoints and escape sequences across chunk boundaries. On the wire the bytes of a `PtyEvent::Data` frame SHALL be encoded as standard base64 (`{ "event": "data", "b64": "<base64>" }`) rather than a JSON array of numbers, and the frontend SHALL decode each frame back to the exact bytes before writing them to xterm.

#### Scenario: Raw bytes forwarded in order over the channel
- **WHEN** the child process emits output to the PTY master
- **THEN** the dedicated read loop sends each chunk as `PtyEvent::Data{bytes}` (a `Vec<u8>`) over that pane's `Channel`, in read order, with no `from_utf8`/string conversion applied in Rust
- **AND** the frontend writes the decoded payload via `term.write(decodePtyBytes(b64))`

#### Scenario: Split multibyte sequence reassembled by xterm
- **WHEN** a multibyte UTF-8 codepoint or ANSI escape sequence is split across two consecutive read chunks
- **THEN** each chunk is forwarded verbatim and xterm reassembles the original sequence, with no replacement characters or corrupted escape sequences introduced by the Rust side

#### Scenario: Output frames decode from base64 to the exact bytes
- **WHEN** the frontend receives a `data` frame whose `b64` encodes arbitrary bytes (including values above 127 and a partial UTF-8 sequence)
- **THEN** decoding yields exactly those bytes, and an empty or malformed frame decodes to no bytes rather than throwing

### Requirement: Input Forwarding To PTY
The system SHALL forward user input from xterm to the PTY via a `pty_write(id, Vec<u8>)` command, passing raw bytes to the PTY writer without decoding. Writes SHALL be enqueued, in call order, to a per-pane writer thread that owns the PTY writer, so the calling (main) thread never blocks on a terminal that has stopped draining its input and never holds the pane registry lock during IO; `pty_write` SHALL remain an ordered (synchronous) command so keystrokes cannot be reordered.

#### Scenario: Keystroke reaches the PTY writer
- **WHEN** the frontend's `term.onData` fires for the focused pane
- **THEN** `invoke('pty_write', { id, data })` is called and the Rust side writes the raw bytes to that pane's PTY writer (`MasterPty::take_writer`)

#### Scenario: Write to a nonexistent pane is rejected
- **WHEN** `pty_write` is invoked with an `id` that has no live pane
- **THEN** the command returns an error and does not panic or affect any other pane

#### Scenario: Writes are queued per pane and never block the caller
- **WHEN** megabytes are written to a pane whose child never reads its input
- **THEN** every write returns immediately, and another pane can still be written to and resized meanwhile
