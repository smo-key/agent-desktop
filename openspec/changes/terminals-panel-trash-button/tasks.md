# Tasks

## 1. Always-on kill-and-close button

- [x] 1.1 Render a single trash button in every terminal slot's header,
      unconditionally (both kinds, running or stopped), replacing the
      stopped-only trash/`×` actions in `RunningTasksPanel.svelte`.
- [x] 1.2 Wire the button to the existing `dismiss` (task) /
      `removeBareTerminal` (bare) handlers so a running entry is dropped,
      unmounting its `TerminalPane` to kill + reap the PTY.
- [x] 1.3 Make the label state-aware: "Kill terminal" while running, "Close
      terminal" once stopped.
- [x] 1.4 Add store regression tests for `dismiss` / `removeBareTerminal` on a
      running entry (the contract the always-on button relies on).
