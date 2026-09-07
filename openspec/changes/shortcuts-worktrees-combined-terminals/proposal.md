# Customizable shortcuts, worktree sessions, and combined terminals

## Why

Three gaps in daily use of the desktop:

1. **Keyboard shortcuts are fixed.** Every binding (⌘N, ⌘J, ⌘W, ⌘↑/↓, …) is
   hard-coded in its handler and only *documented* by the help modal. Users
   with conflicting muscle memory, or whose OS/webview eats a combo, cannot
   change anything.
2. **No worktree sessions.** `claude -w [name]` creates a git worktree for a
   session so parallel agents never collide in one checkout, but the desktop
   has no way to launch one, and once a session is inside a worktree nothing
   in the roster or footer says so (the meta line spends its slot on the
   model name, which the footer already shows).
3. **Terminals live in a separate world.** Plain terminals (task runs and bare
   shells) sit in a right-docked panel with their own two-state status, while
   Claude sessions get the roster with Needs-you / In-flight lanes. Users who
   run a dev server or a build next to their agents want one list and one
   notion of "does this need me".

## What Changes

- **Customizable keyboard shortcuts.** A `Keyboard shortcuts` section in
  Settings lists every rebindable shortcut with a recorder control; a
  recorded chord that another shortcut already uses is refused; each row can
  be reset, and all can be reset at once. Bindings persist in a `shortcuts`
  settings slice. The handlers, help modal, tooltips, and pane-menu hints all
  read the *current* binding instead of a literal.
- **Start a session in a new git worktree.** The launcher gains a "Start in a
  new git worktree" option with an optional name, mapped to
  `claude --worktree [name]` at first spawn only (never re-applied on
  restore). A new global shortcut (default **⌘⇧N**) opens the launcher with
  that option preset and the filtered project preselected.
- **Worktree shown on the row and in the footer.** The statusline wrapper
  detects when a session's git dir is a linked worktree and emits its name;
  the roster row's third line shows it left of the time, replacing the model
  name (removed from the row); the footer's right zone shows a worktree pill
  next to the model pill.
- **Terminals placement preference.** `Settings → Sessions panel → Terminals`
  chooses between the separate right panel (default, today's behavior) and
  combining terminals into the sessions list. In combined placement every
  task run and bare shell is a roster row with a status: a running task, or a
  shell with a foreground job, is **In flight**; an idle shell prompt is
  **Needs you**; a non-zero exit is an error (**Needs you**); a stopped slot is
  **Archived**. Selecting a terminal row shows its live terminal in the focus
  pane without respawning it; the dock and its toggle are hidden.

## Assumptions (made autonomously — see the closing questions)

- Modifier keys are matched literally (⌘ is `metaKey`); no Ctrl-on-Windows
  abstraction is introduced beyond what the handlers already do.
- Esc, bare `?`, the launcher's ⌘Enter, the voice tap, and the in-terminal
  line-edit keys stay fixed; only the app-level action shortcuts are rebindable.
- An idle shell prompt counts as "needs you" (the converse of "a working
  process needs no action"), so it lands in the Needs-you lane like an agent
  waiting for input.
- The worktree name shown is the linked worktree's git-dir basename, which is
  what `claude -w <name>` names it; where the worktree lives on disk is not
  assumed.

## Capabilities

- `keyboard-shortcuts` (ADDED: customizable bindings; MODIFIED: help modal
  reflects current bindings and lists the worktree shortcut)
- `session-launcher` (ADDED: launch a session in a new git worktree)
- `usage-dashboard` (ADDED: snapshot git status names the worktree)
- `agent-roster-display` (MODIFIED: the card shows the worktree, not the model;
  compact-mode wording)
- `footer-actions` (ADDED: footer worktree pill)
- `ui-preferences` (MODIFIED: the `ui` slice gains the terminals placement;
  ADDED: placement preference defaults)
- `tasks-panel` (MODIFIED: the dock applies to the separate placement;
  ADDED: combined placement)
- `agent-status-derivation` (ADDED: terminal-row status)
- `terminal-core` (ADDED: foreground-job query)
