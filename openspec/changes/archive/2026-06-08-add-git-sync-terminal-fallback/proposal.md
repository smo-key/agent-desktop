# Open a terminal when a project Push/Pull fails, and add footer sync buttons

## Why

Project Push/Pull (from the project row's context menu) shells out to
`git push` / `git pull --ff-only` non-interactively and surfaces the outcome as
a toast. When a sync fails — auth required, a rejected non-fast-forward, a
divergent branch, a host-key prompt — a one-line toast is a dead end: the user
can't see git's full output or act on it (authenticate, resolve a conflict,
retry) without leaving the app.

Separately, the same Push/Pull actions are only reachable from the project
pane's context menu. The footer already shows the focused/selected project's git
state with an **ahead** (↑, "push to publish") and a **behind** (↓, "pull to
catch up") indicator — the natural place to also *act*.

## What changes

- **Terminal on failure.** When a project Push or Pull fails, the action opens an
  interactive terminal in the project's folder that runs the failed git command,
  so the user sees git's full output and can act on it. When no terminal surface
  is wired (e.g. unit tests), it falls back to the existing failure toast.
- **Footer sync buttons.** The footer's ahead (↑) indicator becomes a **Push**
  button and the behind (↓) indicator a **Pull** button for the project the
  footer is showing — same behavior as the project context-menu actions
  (success toast; terminal on failure).

## Impact

- Affected specs: `projects` (push/pull surfaces + failure behavior),
  `project-tasks` (a transient bare terminal can run an initial command).
- Affected code: `projectGitActions.ts`, `projectTasks.svelte.ts`,
  `RunningTasksPanel.svelte`, `ProjectPanel.svelte`, `GitInfo.svelte`,
  `AppFooter.svelte`, `+page.svelte`.
