## 1. Backend — git push / pull commands

- [x] 1.1 Add `git::push` / `git::pull --ff-only` (via a shared `run_git_action`
  that returns git's message on both success and failure, and runs git
  non-interactively — `GIT_TERMINAL_PROMPT=0` + `BatchMode=yes` ssh — so a
  prompting remote fails fast instead of hanging), with tests against a bare
  remote (push sends commits, pull fast-forwards, no-remote errors, and a
  divergent pull fails without a mid-merge worktree).
- [x] 1.2 Expose `git_push` / `git_pull` Tauri commands and register them.

## 2. Frontend — context-menu actions

- [x] 2.1 Add a `projectGitActions` module (`pushProject` / `pullProject`) that
  invokes the commands and surfaces git's message via the toast store, with unit
  tests (invoke wiring, success toast, error toast, no-folder warning).
- [x] 2.2 Add **Push** and **Pull** items to the project row context menu in
  `ProjectPanel.svelte`, wired to those actions.
