# Tasks

## 1. Customizable keyboard shortcuts

- [x] 1.1 Pure keybinding module (`src/lib/ui/keybindings.ts`): chord type,
      shortcut definitions with defaults, event→chord, match, format, parse,
      resolve, conflict detection — with tests named after the spec scenarios.
- [x] 1.2 `shortcuts` settings slice store (`src/lib/settings/shortcuts.svelte.ts`)
      with parse/persist tests; hydrate on mount.
- [x] 1.3 Handlers read the store: +page `onKeydown`, Inbox `onNavKey`,
      pane-menu hints; `shortcuts.ts` derives help groups from bindings and the
      help modal renders the live bindings.
- [x] 1.4 Settings `Keyboard shortcuts` section with the `ShortcutRecorder`
      control, per-row reset, reset all, conflict hint.
- [x] 1.5 Tooltips / hints (⌘N, ⌘J, ⌘Y, ⌘W, ⌘., ⌘/) follow the binding.

## 2. Worktree sessions

- [x] 2.1 `worktreeLaunchArgs` + `LaunchRequest.worktree` → `LaunchPlan.launchArgs`
      (claude only) with plan tests.
- [x] 2.2 `PaneSession.launchArgs` threaded through `workspace.launch` and
      `PaneNode`; persistence test proves it is never serialized.
- [x] 2.3 Launcher worktree checkbox + optional name; `launcher.show` presets;
      `startNewWorktreeSession()`; default ⌘⇧N binding + help entry.
- [x] 2.4 Statusline wrapper emits `git.worktree`; Rust `GitStatus.worktree`;
      wrapper tests for linked / main / off-repo.
- [x] 2.5 Roster row: `AgentRow.worktree`, meta line shows worktree left of the
      time, model removed; footer worktree pill (`FooterView.worktree`).

## 3. Combined terminals

- [x] 3.1 `ui.terminalsPlacement` pref + parse tests; Settings dropdown;
      `showTerminalsDock` helper.
- [x] 3.2 Rust `PtyManager::foreground_busy` + `pty_foreground_busy` command with
      integration tests (idle shell / running job / unknown pane).
- [x] 3.3 `runtime.noteForeground`; `TerminalPane` `probeForeground` polling.
- [x] 3.4 `terminalRows.ts`: inputs from the project-terminals store, row
      builder, `deriveTerminalStatus`, focus actions — with scenario tests.
- [x] 3.5 Inbox: concatenate terminal rows in combined placement, terminal focus
      header (Restart / Kill / Close), `terminalSlot` teleport, session-only
      effects skip terminal rows, ⌘W kills/closes a focused terminal, lane
      order/pins skip terminal ids, ⌘Y selects the new row.
- [x] 3.6 `RunningTasksPanel` portals the selected entry's body; dock + toggle
      hidden and ⌘J inert in combined placement.

- [x] 3.7 `terminalInput.ts` accumulator (Return flush, backspace, control keys,
      ring cap) + `TerminalHandle.recentCommands`; `TerminalPane` collects typed
      input only while the foreground probe reports an idle prompt.
- [x] 3.8 Rust `TERMINAL_TITLE_SYSTEM_PROMPT` / `build_terminal_title_body` and
      the `terminal_focus` command reusing the title cleaning + cloud fallback.
- [x] 3.9 `TitleStore.hydrateKeys` / `refreshTerminals` keyed by the terminal's
      title key (task id durable, bare shell per-process); Inbox drives it for
      bare shells only in combined placement.
- [x] 3.10 Inbox rename for terminal rows: `titleKeyOf`, editable focus header,
      "Rename" in the terminal row menu, row shows the generated title.

## 4. Verification

- [x] 4.1 `yarn check`, `yarn test`, `cargo test`, `yarn coverage`,
      `yarn lint:storage` green; MANUAL allowlist entries for the DOM-bound
      scenarios with justifications.
- [ ] 4.2 Adversarial code review; resolve CRITICAL findings.
