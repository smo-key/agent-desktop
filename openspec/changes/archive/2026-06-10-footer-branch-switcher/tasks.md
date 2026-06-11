## 1. Rust: branch git operations

- [x] 1.1 Add a `BranchList { current: Option<String>, local: Vec<String>, remotes: Vec<String> }` serializable struct to `src-tauri/src/git.rs`.
- [x] 1.2 Implement `list_branches(dir) -> BranchList` using `run_git` with `for-each-ref` for `refs/heads` and `refs/remotes` (dropping the symbolic `origin/HEAD`) and `rev-parse --abbrev-ref HEAD` for current (`HEAD`/detached → `None`); return an empty list on any failure (never error).
- [x] 1.3 Implement `checkout(dir, branch) -> Result<String,String>` as `run_git_action(dir, ["checkout", branch])` (relies on git DWIM for remote short names).
- [x] 1.4 Implement `create_branch(dir, name) -> Result<String,String>` as `run_git_action(dir, ["checkout", "-b", name])` off the current HEAD.
- [x] 1.5 Add `git_list_branches` / `git_checkout` / `git_create_branch` Tauri commands in `src-tauri/src/lib.rs` (taking `repo_path`), next to `git_push`/`git_pull`, and register all three in the `invoke_handler` list.
- [x] 1.6 Add Rust unit tests for `list_branches` (a temp repo with a local branch + a fake remote ref, plus a non-repo dir → empty), mirroring existing `git.rs` test style. Name the test fns to MATCH the spec scenario titles (snake_case) so the scenario-coverage gate maps them: `branches_are_listed_with_the_current_branch_marked`, `repository_with_no_remote`, `detached_head`.

## 2. Frontend: targeted status refresh

- [x] 2.1 Add `refreshOne(path)` to `ProjectGitStore` (`src/lib/projects/projectGit.svelte.ts`) that fetches `git_status_for([path])` and MERGES the single entry into `byPath` (leaving other entries intact), unlike `refresh` which replaces the map.
- [x] 2.2 Add a unit test asserting `refreshOne` updates only its own path and preserves other entries.

## 3. Frontend: branch actions module

- [x] 3.1 Create `src/lib/projects/branchActions.ts` with `listBranches(path)` (silent query, returns an empty `BranchList` on error — no toast, no busy guard).
- [x] 3.2 Implement `switchBranch(path, branch, projectName, projectId, onDone?)`: `gitBusy` guard, `invoke('git_checkout')`, success toast + `onDone()` refresh, failure surfaced via the shared interactive-terminal fallback (running `git checkout <branch>`) → toast.
- [x] 3.3 Implement `createBranch(path, name, projectName, projectId, onDone?)`: same shape, `invoke('git_create_branch')`, failure runs `git checkout -b <name>` in the terminal fallback.
- [x] 3.4 Add a `remoteShortName(ref)` helper that strips the remote segment from a remote-tracking ref (e.g. `origin/feature-x` → `feature-x`) for the picker to pass to `switchBranch`.
- [x] 3.5 Add a pure `filterBranches(branches, query)` helper (case-insensitive substring) used by the picker, so the filter behavior is unit-testable.
- [x] 3.6 Reuse the existing `gitTerminalOpener` from `projectGitActions.ts` (share `surfaceFailure`/`oneLine` rather than registering a second opener).
- [x] 3.7 Add `branchActions.test.ts` (mirror `projectGitActions.test.ts`): mock `invoke`. Name each `it(...)` to MATCH the spec scenario titles so the coverage gate maps them: `Successful local switch`, `Checkout blocked by uncommitted changes`, `Remote branch with no local counterpart`, `Remote branch whose local branch already exists`, `Create and switch to a new branch`, `Create with an invalid or duplicate name`, `Second operation is blocked while one is running`, `Filtering narrows the list`.

## 4. Frontend: BranchPicker component

- [x] 4.1 Create `src/lib/usage/BranchPicker.svelte` modeled on `ProjectSelect.svelte`: owns open/filter/highlight state; trigger is the branch pill rendered as a `<button>`.
- [x] 4.2 Menu opens UPWARD (`bottom: calc(100% + 6px)`) with `max-height` + internal scroll; styled with existing design tokens.
- [x] 4.3 On open, call `listBranches(path)`; render a filter `<input>`, a Local section (current branch checkmarked), and a Remotes section (shown only when non-empty).
- [x] 4.4 Keyboard nav (Arrow/Home/End/Enter/Escape) with a roving highlight over the FILTERED options, scrolling the active item into view.
- [x] 4.5 Selecting a local branch → `switchBranch`; selecting a remote → `switchBranch` with `remoteShortName(ref)`; both close the menu.
- [x] 4.6 Inline create row (seeded with the filter text) → `createBranch`; closes the menu.
- [x] 4.7 Reflect `gitBusy.isBusy(path)` as a disabled/busy state so a second operation can't be triggered while one runs.
- [x] 4.8 Guard the no-branch / no-folder / non-repo case so the picker does not open.

## 5. Wire into the footer

- [x] 5.1 In `GitInfo.svelte`, render the branch pill as a `<button>` when a branch-pick callback prop is supplied (mirroring the `onPush`/`onPull` span/button switch); keep it a read-only `<span>` otherwise.
- [x] 5.2 In `AppFooter.svelte`, compose `BranchPicker` around the footer branch pill, passing `gitProject` path/name/id and an `onDone = () => projectGit.refreshOne(gitProject.path)` callback; supply the pick wiring only here (project pane stays read-only).
- [x] 5.3 Verify the existing footer `onPush`/`onPull` wiring and layout (ellipsis on long branch names) still behave after the pill becomes a button.

## 6. Scenario-coverage enforcement

- [x] 6.1 Add `git-branch-switching` to `ENFORCED_CAPABILITIES` in `tools/check-scenario-coverage.mjs`, with a short rationale comment mirroring the existing entries.
- [x] 6.2 Add a `git-branch-switching` entry to `MANUAL_SCENARIOS` listing the three DOM-bound scenarios as headless-exempt: `footer_pill_is_actionable`, `non_footer_pill_stays_read_only`, `no_branch_to_switch`.
- [x] 6.3 Run `node tools/check-scenario-coverage.mjs`; confirm `git-branch-switching` reports 11 covered + 3 manual, 0 missing, and the gate stays PASS.

## 7. Verify

- [x] 7.1 Run the frontend unit tests (`branchActions`, `projectGit.refreshOne`) and the Rust tests; all green.
- [x] 7.2 Run the full pre-commit gate (`npm run check`, the scenario-coverage gate, `openspec validate --changes --strict`); all green.
- [x] 7.3 Manually verify against a real repo: switch a local branch, check out a remote branch (new tracking branch created), create a new branch, and a dirty-tree checkout failure surfaces git's message — confirming the footer refreshes on success.
- [x] 7.4 `openspec validate footer-branch-switcher --strict` passes.

## 8. Review fixes (adversarial-code-review)

- [x] 8.1 CRITICAL — guard `checkout` against git option injection: pass `--end-of-options` before the branch so a `-`-prefixed ref (e.g. `-f`, leaked from `refs/remotes/origin/-f`) is treated as a ref, never the force flag (which would silently discard the working tree). Add a regression test + spec scenario. (`create_branch` is unaffected — git rejects `-`-prefixed names after `-b`.)
