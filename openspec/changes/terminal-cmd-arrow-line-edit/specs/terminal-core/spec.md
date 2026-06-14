# terminal-core delta

## ADDED Requirements

### Requirement: Line-Edit Keys From The Host Keyboard

The system SHALL translate the macOS line-edge chords ⌘← and ⌘→, pressed while a terminal pane is focused, into the readline/emacs line-edge control bytes — Ctrl-A (`\x01`, beginning of line) for ⌘← and Ctrl-E (`\x05`, end of line) for ⌘→ — and write them to that pane's PTY, consuming the keystroke so it neither echoes nor triggers a webview accelerator. The translation SHALL require ⌘ and exclude ⌥ and ⌃, so that ⌥← (word-wise motion) and ⌃← fall through to xterm unchanged. This restores the standard macOS "jump to beginning/end of the current line" behavior inside a terminal, where xterm otherwise forwards nothing for ⌘-modified arrows (native `<input>`/`<textarea>` fields already get it from the webview).

#### Scenario: Cmd-Left and Cmd-Right map to the readline line-edge bytes

- **WHEN** the line-edit mapping is evaluated for a bare ⌘← chord (⌘ held, ⌥ and ⌃ absent)
- **THEN** it yields the byte `\x01` (Ctrl-A, beginning of line)
- **AND** a bare ⌘→ chord yields the byte `\x05` (Ctrl-E, end of line)
- **AND** a chord without ⌘, or with ⌥ or ⌃ also held, or on any key other than ArrowLeft/ArrowRight, yields nothing (so the keystroke is left for xterm)

#### Scenario: Cmd-Left or Cmd-Right in a focused terminal moves to the line edge

- **WHEN** the user presses ⌘← (or ⌘→) while a terminal pane holds focus
- **THEN** the pane's custom key handler writes the mapped byte (`\x01` / `\x05`) to that pane's PTY and consumes the keydown (preventDefault + returns false), so the running program (a shell or Claude's TUI) moves the cursor to the beginning/end of the current line and the chord does not echo or fire a webview accelerator
