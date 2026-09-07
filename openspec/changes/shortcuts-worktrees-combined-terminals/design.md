# Design

## D1 — Keybinding model and dispatch

- A pure module `src/lib/ui/keybindings.ts` owns the vocabulary: `KeyChord`
  (`{ key, meta, ctrl, alt, shift }`), the enumerated `ShortcutId`s with their
  labels, groups, and default chords, `chordFromEvent`, `chordMatches`,
  `formatChord` (display tokens: ⌘ ⌃ ⌥ ⇧ ↑ ↓ ← → Tab Enter Esc), `parseChord`
  (validating a persisted value), `resolveBindings(overrides)`, and
  `findConflict`. A recordable chord needs a non-modifier key plus at least
  one of ⌘/⌃/⌥ (or a function key), so plain typing can never be captured.
- `src/lib/settings/shortcuts.svelte.ts` is the `shortcuts` settings slice
  (`{ overrides: Partial<Record<ShortcutId, KeyChord>> }`), sole writer, with
  `matches(e, id)`, `text(id)`, `setBinding`, `resetBinding`, `resetAll`.
- The two `svelte:window` handlers (+page `onKeydown`, Inbox `onNavKey`) and
  the pane menu swap their literal checks for `shortcuts.matches`. Fixed keys
  (Esc, `?`, dialog ⌘Enter, terminal ⌘←/→, voice tap) are untouched and
  listed under a fixed group in the help modal.
- `src/lib/ui/shortcuts.ts` keeps exporting `SHORTCUTS` (the default
  bindings rendered as groups) for the existing registry tests, plus
  `shortcutGroups(bindings)` which the help modal renders from the live store.
- Settings UI: a `Keyboard shortcuts` section with one row per rebindable
  shortcut; a `ShortcutRecorder.svelte` control shows the chord, enters a
  "Press keys…" state on click, records the next keydown, and refuses a
  conflicting chord with an inline hint. A reset glyph appears when the row is
  overridden; a "Reset all" link sits in the section header.

## D2 — Worktree launch and display

- `worktreeLaunchArgs(name)` (pure, `src/lib/launcher/worktreeArgs.ts`)
  returns `['--worktree']` or `['--worktree', name]`.
- `LaunchRequest.worktree?: { name?: string | null } | null` →
  `LaunchPlan.launchArgs: string[]` — **launch-time-only** CLI args. Only the
  `claude` backend supports `--worktree`; for any other backend the plan's
  `launchArgs` is empty.
- `PaneSession.launchArgs?: string[]` is threaded through
  `workspace.launch → newWorkspace/splitWith → makeEntry` exactly like
  `initialInput`, and like it is **not persisted** (`persistence.ts` only
  re-projects known fields). `PaneNode` passes
  `[...launchArgs, ...extraArgs]` as the pane's `args`.
- Launcher: a checkbox row ("Start in a new git worktree") reveals an optional
  name input. `launcher.show({ worktree, projectId })` presets both; the
  modal seeds its form from the preset on the open transition. The new
  `startNewWorktreeSession()` always opens the launcher (the name is optional
  but must be enterable) with the filtered project preselected.
- Detection lives in the statusline wrapper's `gitStatus`: `git rev-parse
  --git-dir` vs `--git-common-dir` (both resolved to absolute paths). When
  they differ the checkout is a linked worktree and `git.worktree` is the
  git-dir basename; otherwise `null`. The Rust `GitStatus` gains
  `worktree: Option<String>` (`serde(default)`), the TS `GitStatus` gains
  `worktree?: string | null`.
- `AgentRow.worktree` (from `snapshot.git.worktree`) replaces the model on
  the meta line; `FooterView.worktree` drives a `worktree-pill`.

## D3 — Combined terminals

- Preference: `ui.terminalsPlacement: 'panel' | 'combined'` (default
  `panel`), parsed with the other `ui` fields. A pure
  `showTerminalsDock(placement, open)` decides dock visibility.
- Rows: `src/lib/overview/terminalRows.ts` (pure) turns the project-terminals
  store's data (task defs with a runtime + bare shells, per project) into
  `TerminalRowInput`s and then into `AgentRow`s with `kind: 'terminal'`,
  `terminalKey`, `running`, `workspaceId: ''`. The Inbox concatenates them
  onto `buildRoster`'s rows only in combined placement; every effect that
  acts on sessions (auto-archive, auto-resume, preview, summaries) skips
  terminal rows; persisted lane order and pins never store terminal ids
  (they are per-process).
- Status: `deriveTerminalStatus(input, runtime, nowMs)`:
  not running → `error` (non-zero exit) / `finished`; a running **task** →
  `working`; a running **bare shell** → `working` when a foreground job is
  known to be running, `waiting` when the prompt is known idle, else the
  output-activity fallback (`deriveStatus`).
- Foreground probe: `PtyManager::foreground_busy(id)` (unix: the master's
  `process_group_leader()` differs from the child pid → a job owns the
  terminal; Windows / unknown → `None`), exposed as the `pty_foreground_busy`
  command. `TerminalPane` polls it once a second while its new
  `probeForeground` prop is true and records `runtime.foregroundBusy` via
  `noteForeground`. Only bare shells in combined placement are probed.
- Surface: the dock (`RunningTasksPanel`) stays mounted as every terminal's
  PTY home. A `terminalSlot` singleton (mirroring `surfaceSlot`) names the
  selected terminal pane and a target element; the matching entry's body is
  relocated with the existing `portal` action into the Inbox focus column and
  restored when deselected — the terminal is never remounted. The focus header
  for a terminal row offers Restart (tasks) and Kill / Close.
- In combined placement the `<aside>` dock and the title-bar toggle are
  hidden and ⌘J is inert; ⌘Y still creates a bare shell and requests focus on
  its new row through `focusRequest`.
