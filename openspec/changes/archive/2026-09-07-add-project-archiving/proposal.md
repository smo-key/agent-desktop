# Archive projects, and drop the Worktrees dialog

## Why

The project pane grows with every folder a user has ever worked in. Finished or
dormant projects crowd the list, the launcher's project picker, and the
⌘⇧↑/↓ filter cycle, and every one of them is still git-polled and
background-fetched on a clock. Users want to tuck a project away without
deleting it (which drops the label from its sessions for good) and bring it
back later.

Separately, the per-project "Worktrees…" context-menu dialog (list / open /
prune the manual worktrees under `<repo>/.worktrees/`) is unused since the
auto-worktree feature was removed, and it is the only surface for three Rust
commands. It is removed outright.

## What Changes

- A project record gains an optional `archived` flag, persisted in
  `projects.json`; a missing flag means active.
- A project row's context menu offers **Archive project**; archiving hides the
  project from the project pane rows and icon rail, the launcher's project
  picker, the keyboard filter cycle, and the git status poll / background
  fetch. Its agents keep their binding, avatar, and place in "All agents".
- A **Show archived (N)** button below **New project** (only when N > 0) reveals
  an "Archived" section listing archived projects; each archived row's context
  menu offers **Unarchive** (restores it in place) and **Delete project**.
- The **Worktrees…** context-menu item, `WorktreeDialog`, the `worktreePanel`
  store, and the `worktree_create` / `worktree_list` / `worktree_remove` Tauri
  commands with their git helpers and tests are deleted.

## Assumptions (made autonomously — see the closing questions)

- Archiving never asks for confirmation: it is reversible.
- The "Show archived" toggle is session-local (not persisted).
- Selecting an archived row (while shown) still filters the roster to it, so
  its running agents stay reachable.

## Capabilities

- `projects` (ADDED requirements: archive/unarchive; archived projects hidden
  from active surfaces)
- `project-worktrees` (REMOVED requirement: manage a project's worktrees)
