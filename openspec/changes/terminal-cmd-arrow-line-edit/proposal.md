# Cmd+Left/Right jump to line start/end in the terminal

## Why

On macOS, ⌘← and ⌘→ jump the cursor to the beginning and end of the current
line — the convention everywhere text is edited. Inside a terminal pane this does
nothing: xterm captures keys through a hidden `<textarea>` and forwards no bytes
for ⌘-modified arrows, so the keystroke is swallowed. (Native `<input>` /
`<textarea>` fields in the app already get this behavior from WKWebView for free
— only the xterm panes are missing it.) Users reach for ⌘← out of muscle memory
in a Claude session or shell and nothing happens.

## What Changes

- **⌘← / ⌘→ move to the beginning / end of the current line in a terminal.**
  When a terminal pane is focused, ⌘← is translated to Ctrl-A (`\x01`) and ⌘→ to
  Ctrl-E (`\x05`) — the universal readline/emacs line-edge bindings that bash,
  zsh, fish, and Claude Code's TUI all honor — and written to the pane's PTY. The
  keystroke is consumed (preventDefault + return false) so it neither echoes nor
  fires a webview accelerator.
- **Only the bare ⌘ chord is intercepted.** ⌥← (word-wise) and ⌃← are excluded
  and fall through to xterm unchanged; non-arrow keys and the vertical arrows are
  untouched.

## Impact

- Affected specs: `terminal-core` (new requirement: Line-Edit Keys From The Host
  Keyboard).
- Affected code: `src/lib/TerminalPane.svelte` (one branch in the existing
  `attachCustomKeyEventHandler`), plus a new pure helper
  `src/lib/terminalKeys.ts` (`lineEditSeq`) with unit tests.
- No backend, persistence, or config changes.
