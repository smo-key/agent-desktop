# Always-on trash button on each terminal in the Terminals panel

## Why

Each terminal in the right-docked Terminals panel only exposed an action button
(trash for a stopped task, `×` for a stopped bare shell) **after** its process
had exited. While a terminal was still running, its header had no button, so
there was no way to kill and dismiss a running terminal from its own slot — the
user had to stop it elsewhere first. The header should always offer a single,
direct "kill and close" affordance.

## What changes

- Every terminal slot in the panel — task or bare shell, running or stopped —
  always renders one trash button in its header.
- Clicking it kills the terminal's process (if still running) and closes its
  slot in one action: the entry is dropped from the running surface, which
  unmounts its `TerminalPane`, whose teardown kills + reaps any live PTY. A def
  remains in the launcher; a bare shell is gone entirely.
- The button's label tracks state — "Kill terminal" while running, "Close
  terminal" once stopped — and uses the trash icon in both states (replacing the
  former `×` for bare shells).

## Impact

- Affected specs: `terminals-panel` (new requirement).
- Affected code: `src/lib/tasks/RunningTasksPanel.svelte` (header action). No
  store API change — it reuses the existing `dismiss` / `removeBareTerminal`
  actions, now also invoked while an entry is running.
