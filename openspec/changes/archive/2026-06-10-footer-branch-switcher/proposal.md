## Why

The footer shows the focused project's current git branch, but it is a read-only
pill — to switch branches the developer has to drop into a terminal and run
`git checkout` by hand, then wait for the footer to catch up. Making that pill
the place you also *change* branches keeps a common operation in the surface that
already tells you where you are.

## What Changes

- The footer's branch pill (`GitInfo.svelte`, currently display-only) becomes a
  **button** that opens a branch picker, mirroring how `onPush`/`onPull` already
  turn the ahead/behind pills into action buttons **only when wired from the
  footer**. The project pane's branch pill stays read-only.
- A new **branch picker** dropdown opens **upward** from the footer pill and lets
  the developer:
  - **Switch** to an existing **local** branch (the current branch is marked).
  - Check out a **remote-tracking** branch, creating a local tracking branch for
    it (or just switching, if a local branch of that name already exists).
  - **Create a new branch** off the current `HEAD` via an inline create row
    (`git checkout -b`), mirroring `ProjectSelect`'s inline "New project" row.
  - **Type-to-filter** the branch lists for repos with many branches.
- New non-interactive git operations surface git's own message on success/failure,
  exactly like the existing push/pull actions: list branches, checkout, and
  create-branch.
- Branch actions live in a unit-tested frontend module (mirroring
  `projectGitActions.ts`): they invoke the git command, confirm with a toast on
  success, fall back to an **interactive terminal** in the project folder on
  failure (so the developer can authenticate / resolve conflicts), and use the
  shared `gitBusy` guard against double-triggering. A dirty working tree that
  blocks a switch is not pre-checked — git refuses to overwrite local changes, so
  its error is surfaced like any other.
- After a successful switch/create, the footer's folder git status is refreshed so
  the new branch (and ahead/behind/modified) shows immediately rather than waiting
  for the next slow poll.

## Capabilities

### New Capabilities
- `git-branch-switching`: Listing a project's branches and switching the footer's
  project to another local branch, a remote-tracking branch (as a new local
  tracking branch), or a newly created branch — initiated from the footer's branch
  pill, with git's own output surfaced on success/failure.

### Modified Capabilities
<!-- None: the footer's existing git push/pull behavior is not specified as a
     durable capability, and this change does not alter it. -->

## Impact

- **Frontend (Svelte 5 / Tauri):**
  - `src/lib/usage/GitInfo.svelte` — optional branch-pick callback prop turns the
    branch pill into a button (footer only).
  - `src/lib/usage/AppFooter.svelte` — wires the picker to the footer's
    `gitProject` (path/name/id) and triggers a status refresh after a switch.
  - New `BranchPicker` component (modeled on `ProjectSelect.svelte`).
  - New `branchActions.ts` module (modeled on `projectGitActions.ts`), unit-tested;
    reuses `gitBusy`, `toast`, and the `gitTerminalOpener` failure fallback.
  - `src/lib/projects/projectGit.svelte.ts` — a way to force-refresh a folder's
    status after a switch.
- **Backend (Rust / Tauri commands):**
  - `src-tauri/src/git.rs` — `list_branches`, `checkout`, and `create_branch`
    helpers using the existing `run_git` / `run_git_action` semantics.
  - `src-tauri/src/lib.rs` — new `git_list_branches` / `git_checkout` /
    `git_create_branch` commands registered in the `invoke_handler`.
- **Out of scope:** merge, delete-branch, rebase, stash, and conflict-resolution
  UI; the project-pane branch pill remains read-only.
