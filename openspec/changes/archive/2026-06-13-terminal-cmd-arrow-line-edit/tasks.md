# Tasks — terminal-cmd-arrow-line-edit

## 1. Line-edit key mapping (TS — `src/lib/terminalKeys.ts`)
- [x] 1.1 Add a pure `lineEditSeq(chord)` helper returning `\x01` for ⌘←, `\x05` for ⌘→, else `null`; require `metaKey`, exclude `altKey`/`ctrlKey`
- [x] 1.2 Unit tests (`terminalKeys.test.ts`): the byte mapping for ⌘←/⌘→, and the gating (bare arrow, ⌥, ⌃, vertical arrows, other keys all yield `null`)

## 2. Wire into the terminal (Svelte — `src/lib/TerminalPane.svelte`)
- [x] 2.1 In `attachCustomKeyEventHandler`, on a keydown call `lineEditSeq(e)`; when it returns a sequence, `preventDefault`, `pty_write` the encoded bytes to the focused pane, and `return false`
- [x] 2.2 Import `lineEditSeq` from `./terminalKeys`

## 3. Coverage gate
- [x] 3.1 Mark the live-wiring scenario headless-exempt in `tools/check-scenario-coverage.mjs` (`MANUAL_SCENARIOS['terminal-core']`); the byte-mapping scenario is covered by the unit test
- [x] 3.2 `yarn coverage` passes for `terminal-core`
