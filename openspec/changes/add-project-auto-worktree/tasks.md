## 1. Project model: the `autoWorktree` setting

- [ ] 1.1 Add optional `autoWorktree?: boolean` to the `Project` interface in `src/lib/projects/projects.ts`; ensure serialize/deserialize preserves it and absent ⇒ `false` (no `PROJECTS_VERSION` bump — additive, like `logo`).
- [ ] 1.2 Add/extend unit tests in `src/lib/projects/projects.test.ts`: round-trip preserves `autoWorktree`; legacy projects without the field load as `false`/undefined.

## 2. Project form UI: the toggle

- [ ] 2.1 Add an auto-worktree toggle to `src/lib/projects/ProjectForm.svelte` (state seeded from `initial`, included in the `onSave` draft), matching the form's existing control styling.
- [ ] 2.2 Confirm the save flow (`ProjectPanel`/`ProjectDialog` → `projects.update`) carries the new field through unchanged; reopening the edit form reflects the saved value.

## 3. Backend: worktree git commands (Rust)

- [ ] 3.1 In `src-tauri/src/git.rs`, add a `worktree_create(repo_path) -> { path, branch, base }` helper: generate `session/<timestamp>-<id>`, ensure `.worktrees` is in the repo-root `.gitignore` (idempotent append), run `git worktree add -b <branch> <repo>/.worktrees/<branch> HEAD`, return path + branch + base SHA. Reuse the existing `run_git` helper; return `Err` on any git failure.
- [ ] 3.2 Add `worktree_remove_if_clean(worktree_path, base) -> { removed, reason }`: clean ⇔ `status --porcelain` empty AND `rev-list <base>..HEAD --count == 0`; when clean, `git worktree remove` + delete the branch; otherwise leave intact. Never error the caller for "kept".
- [ ] 3.3 Add `worktree_list(repo_path) -> Vec<WorktreeInfo>` (`{ path, branch, clean }`) covering worktrees under `.worktrees`, and `worktree_remove(worktree_path, force) -> Result<(), String>` for explicit pruning (force removes dirty worktrees).
- [ ] 3.4 Register all four commands as `#[tauri::command]` wrappers in `src-tauri/src/lib.rs` and add them to the `generate_handler!` list.
- [ ] 3.5 Add Rust unit/integration coverage where practical (e.g. `.gitignore` idempotency, clean-vs-dirty decision) using a temp git repo.

## 4. Launch flow: create + use the worktree

- [ ] 4.1 Add a frontend wrapper (e.g. in a new `src/lib/launcher/worktree.ts`) that invokes `worktree_create` and returns `{ path, branch, base } | null`, swallowing/normalizing errors for the fallback path. Unit-test the fallback shape with the Tauri invoke mocked.
- [ ] 4.2 Make `startNewSession()` in `src/lib/launcher/newSession.ts` (and the launcher dialog's submit) async: when the chosen project has `autoWorktree`, await creation and use the worktree path as `folder`; on failure, fall back to `project.path` and show a non-blocking warning toast. Keep `buildLaunchPlan` pure (resolution happens before it).
- [ ] 4.3 Carry `worktreePath` + `worktreeBase` on the pane's registry entry in `src/lib/layout/workspace.svelte.ts` (`makeEntry`/`launch`), recorded verbatim at launch like `projectId`/`cwd`.

## 5. Cleanup on session close

- [ ] 5.1 In `workspace.svelte.ts`, hook permanent-close paths (`closeFocused`, `closeWorkspace` — where the registry entry is pruned) to fire `worktree_remove_if_clean(worktreePath, worktreeBase)` best-effort/fire-and-forget when the closing entry has a worktree. Do NOT trigger on `closeAgent` (archive stays resumable).
- [ ] 5.2 Add tests covering: close of a clean-worktree pane invokes removal; close of a dirty/changed one keeps it; archive does not invoke removal; panes without a worktree are unaffected (Tauri invoke mocked).

## 6. Worktree management UI

- [ ] 6.1 Build a worktree-management surface (reached from the project panel/form) that lists a project's worktrees via `worktree_list` with path, branch, and clean/changed state, including an empty state.
- [ ] 6.2 Wire "open" (launch a session into an existing worktree path) and "prune" (call `worktree_remove`, requiring explicit confirmation/force when the worktree has changes).
- [ ] 6.3 Add component tests for list rendering, the dirty-prune confirmation gate, and the open action.

## 7. Validate

- [ ] 7.1 Run the frontend test suite and `cargo test` for the Rust changes; ensure green.
- [ ] 7.2 Run `openspec validate add-project-auto-worktree --strict` and reconcile any drift between code and spec.
