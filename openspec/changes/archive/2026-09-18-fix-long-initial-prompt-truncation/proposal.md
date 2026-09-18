## Why

Long initial prompts (notably agent Tasks, whose prompts run past 1 KB) reached the
agent truncated: only the TAIL of the prompt was submitted. Reproduced against a
live `claude`: the prompt was written as one raw, un-bracketed `pty_write`; the tty
hands the TUI that input as a 1024-byte chunk plus a remainder, and the TUI drops
the first chunk. The input box began at exactly the ~1024-byte mark.

## What Changes

- The initial prompt is delivered to AGENT panes (claude / copilot) as an xterm
  bracketed paste (`ESC[200~ … ESC[201~`), so the TUI takes it as one paste
  regardless of how the tty chunks it. Verified end-to-end with a 1.4 KB prompt.
- An embedded paste-end marker in the prompt is stripped so it cannot close the
  paste early.
- Shell panes (terminal tasks) keep the raw write — a shell line editor may not have
  paste mode on. The submitting Enter stays a separate, later write.

## Impact

- `src/lib/launcher/initialInput.ts`, `src/lib/TerminalPane.svelte`
- Spec: `session-launcher` — Optional Initial Prompt
