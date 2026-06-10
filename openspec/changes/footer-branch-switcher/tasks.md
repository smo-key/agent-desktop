## 1. Rust: branch git operations

- [ ] 1.1 Add a `BranchList { current: Option<String>, local: Vec<String>, remotes: Vec<String> }` serializable struct to `src-tauri/src/git.rs`.
- [ ] 1.2 Implement `list_branches(dir) -> BranchList` using `run_git` with `for-each-ref` for `refs/heads` and `refs/remotes` (dropping the symbolic `origin/HEAD`) and `rev-parse --abbrev-ref HEAD` for current (`HEAD`/detached → `None`); return an empty list on any failure (never error).
- [ ] 1.3 Implement `checkout(dir, branch) -> Result<String,String>` as `run_git_action(dir, ["checkout", branch])` (relies on git DWIM for remote short names).
- [ ] 1.4 Implement `create_branch(dir, name) -> Result<String,String>` as `run_git_action(dir, ["checkout", "-b", name])` off the current HEAD.
- [ ] 1.5 Add `git_list_branches` / `git_checkout` / `git_create_branch` Tauri commands in `src-tauri/src/lib.rs` (taking `repo_path`), next to `git_push`/`git_pull`, and register all three in the `invoke_handler` list.
- [ ] 1.6 Add Rust unit tests for `list_branches` (a temp repo with a local branch + a fake remote ref, plus a non-repo dir → empty), mirroring existing `git.rs` test style.

## 2. Frontend: targeted status refresh

- [ ] 2.1 Add `refreshOne(path)` to `ProjectGitStore` (`src/lib/projects/projectGit.svelte.ts`) that fetches `git_status_for([path])` and MERGES the single entry into `byPath` (leaving other entries intact), unlike `refresh` which replaces the map.
- [ ] 2.2 Add a unit test asserting `refreshOne` updates only its own path and preserves other entries.

## 3. Frontend: branch actions module

- [ ] 3.1 Create `src/lib/projects/branchActions.ts` with `listBranches(path)` (silent query, returns an empty `BranchList` on error — no toast, no busy guard).
- [ ] 3.2 Implement `switchBranch(path, branch, projectName, projectId, onDone?)`: `gitBusy` guard, `invoke('git_checkout')`, success toast + `onDone()` refresh, failure surfaced via the shared interactive-terminal fallback (running `git checkout <branch>`) → toast.
- [ ] 3.3 Implement `createBranch(path, name, projectName, projectId, onDone?)`: same shape, `invoke('git_create_branch')`, failure runs `git checkout -b <name>` in the terminal fallback.
- [ ] 3.4 Add a `remoteShortName(ref)` helper that strips the remote segment from a remote-tracking ref (e.g. `origin/feature-x` → `feature-x`) for the picker to pass to `switchBranch`.
- [ ] 3.5 Reuse the existing `gitTerminalOpener` from `projectGitActions.ts` (share `surfaceFailure`/`oneLine` rather than registering a second opener).
- [ ] 3.6 Add `branchActions.test.ts` (mirror `projectGitActions.test.ts`): mock `invoke`; assert success toast + `onDone` fired, busy-guard no-op on double trigger, failure path, and `remoteShortName` derivation.

## 4. Frontend: BranchPicker component

- [ ] 4.1 Create `src/lib/usage/BranchPicker.svelte` modeled on `ProjectSelect.svelte`: owns open/filter/highlight state; trigger is the branch pill rendered as a `<button>`.
- [ ] 4.2 Menu opens UPWARD (`bottom: calc(100% + 6px)`) with `max-height` + internal scroll; styled with existing design tokens.
- [ ] 4.3 On open, call `listBranches(path)`; render a filter `<input>`, a Local section (current branch checkmarked), and a Remotes section (shown only when non-empty).
- [ ] 4.4 Keyboard nav (Arrow/Home/End/Enter/Escape) with a roving highlight over the FILTERED options, scrolling the active item into view.
- [ ] 4.5 Selecting a local branch → `switchBranch`; selecting a remote → `switchBranch` with `remoteShortName(ref)`; both close the menu.
- [ ] 4.6 Inline create row (seeded with the filter text) → `createBranch`; closes the menu.
- [ ] 4.7 Reflect `gitBusy.isBusy(path)` as a disabled/busy state so a second operation can't be triggered while one runs.
- [ ] 4.8 Guard the no-branch / no-folder / non-repo case so the picker does not open.

## 5. Wire into the footer

- [ ] 5.1 In `GitInfo.svelte`, render the branch pill as a `<button>` when a branch-pick callback prop is supplied (mirroring the `onPush`/`onPull` span/button switch); keep it a read-only `<span>` otherwise.
- [ ] 5.2 In `AppFooter.svelte`, compose `BranchPicker` around the footer branch pill, passing `gitProject` path/name/id and an `onDone = () => projectGit.refreshOne(gitProject.path)` callback; supply the pick wiring only here (project pane stays read-only).
- [ ] 5.3 Verify the existing footer `onPush`/`onPull` wiring and layout (ellipsis on long branch names) still behave after the pill becomes a button.

## 6. Verify

- [ ] 6.1 Run the frontend unit tests (`branchActions`, `projectGit.refreshOne`) and the Rust tests; all green.
- [ ] 6.2 Manually verify against a real repo: switch a local branch, check out a remote branch (new tracking branch created), create a new branch, and a dirty-tree checkout failure surfaces git's message — confirming the footer refreshes on success.
- [ ] 6.3 `openspec validate footer-branch-switcher --strict` passes.
