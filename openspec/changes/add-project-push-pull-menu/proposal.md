## Why

The project rows in the project pane already surface each project's git branch
and ahead/behind state, and their right-click context menu offers Edit /
Worktrees / Delete — but there is no way to actually **sync** a project with its
remote without dropping into a terminal. Push and Pull are the two most common
git actions a user wants once they can see a row is ahead or behind, so they
belong right on that menu.

## What Changes

- Add **Push** and **Pull** items to a project row's right-click context menu in
  the project pane, between "Worktrees…" and "Delete project".
- **Push** runs `git push` in the project's folder; **Pull** runs `git pull`.
  Both are fired against the project's checkout (not a running agent's pane), so
  they work whether or not a session is open in that project.
- The outcome is surfaced **non-blockingly via a toast** — a success toast
  echoing git's own message (e.g. "Everything up-to-date") or a failure toast
  carrying git's error (no upstream, rejected, conflict, offline). Neither action
  ever throws out of the menu.
- A project whose folder is unset warns via a toast instead of invoking git.

## Impact

- New Tauri commands `git_push` / `git_pull` (thin wrappers over `git::push` /
  `git::pull`, which shell out to `git -C <dir>`), surfacing git's message on
  both success and failure.
- New frontend `projectGitActions` module (`pushProject` / `pullProject`) wiring
  the commands to the toast store, and two new context-menu items in
  `ProjectPanel.svelte`.
- Affected capability: `projects`.
