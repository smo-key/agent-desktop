## 1. Launch path — remove auto-create

- [x] 1.1 Remove the `loadAutoWorktree` check and `createWorktree` call from `src/lib/launcher/newSession.ts` (and the equivalent logic in `src/lib/launcher/Launcher.svelte`); sessions always launch in the project path (drop the worktree warning toast tied to auto-create).
- [x] 1.2 Remove `worktreePath`/`worktreeBase` from `LaunchRequest` and `LaunchPlan` in `src/lib/launcher/plan.ts`; update `src/lib/launcher/plan.test.ts` to drop the worktree pass-through cases.
- [x] 1.3 Delete `src/lib/launcher/worktree.ts` and `src/lib/launcher/worktree.test.ts`.

## 2. Close path — remove auto-cleanup

- [x] 2.1 Remove `cleanupWorktree` and the `worktreePath`/`worktreeBase` fields from `PaneSession` in `src/lib/layout/workspace.svelte.ts`, and its calls in `closeFocused()`/`closeWorkspace()`/`deleteAgent()`; drop the two now-unused worktree slots from `makeEntry`/`newWorkspace`/`spawnPaneId`/`splitWith`/`launch` and the `invoke` import.
- [x] 2.2 Remove the cleanup-on-close / archive-preserves-worktree cases from `src/lib/layout/workspace.svelte.test.ts` (and fix the `newWorkspace` arity in `workspace`/`coordinator.svelte.test.ts`); keep the rest green.
- [x] 2.3 Verify the manual `worktreePanel.open()` still launches a session using the worktree path as `folder` (no reliance on the removed fields); refresh its stale comment.

## 3. Project form & settings UI

- [x] 3.1 Remove the auto-worktree toggle (markup + CSS), its state, and folder-config seeding from `src/lib/projects/ProjectForm.svelte`; stop including `autoWorktree` in the submitted draft.
- [x] 3.2 Remove the `saveAutoWorktree` import and the autoWorktree split/save in `src/lib/projects/ProjectPanel.svelte` (keep the "Worktrees…" menu + `WorktreeDialog`).

## 4. Project model & folder-config scaffolding

- [x] 4.1 Remove `ProjectDraft.autoWorktree` from `src/lib/projects/projects.ts`; KEEP a one-line legacy strip of `autoWorktree` in `normalize()` (object spread otherwise round-trips the stray key) and keep the (reworded) regression test in `src/lib/projects/projects.test.ts`.
- [x] 4.2 Delete `src/lib/projects/projectFolderConfig.ts`.
- [x] 4.3 Remove `ProjectConfig`/`PROJECT_CONFIG_VERSION` and their parse/serialize from `src/lib/tasks/projectTasks.ts`; drop the config round-trip cases + imports from `src/lib/tasks/projectTasks.test.ts`.
- [x] 4.4 Remove the `autoWorktree` lift into `config.json` and the now-redundant `projects.json` re-save (normalize strips the field on every load) from `src/lib/projects/migrateProjectFolders.ts`, keeping the tasks migration + both-source-files cleanup + idempotency intact; trim the autoWorktree/config cases from `src/lib/projects/migrateProjectFolders.test.ts`.

## 5. Backend (Rust)

- [x] 5.1 Remove the `worktree_remove_if_clean` Tauri command (and its registration) from `src-tauri/src/lib.rs`, and the `worktree_remove_if_clean` fn + `WorktreeRemoval` struct from `src-tauri/src/git.rs`; keep `worktree_create`/`worktree_list`/`worktree_remove` and the shared helpers (`ensure_worktrees_ignored`, `main_repo_dir`, `remove_worktree`, `branch_for_worktree`, `delete_branch`) still used by the manual commands.
- [x] 5.2 Remove the auto-cleanup test cases (`clean_worktree_is_removed_on_close`, `dirty_worktree_is_kept_on_close`) from `src-tauri/src/git.rs` and rename `launching_an_auto_worktree_project` → `worktree_create_makes_a_session_worktree`; keep create/list/prune tests.
- [x] 5.3 Remove the `project_config_load` / `project_config_save` Tauri commands (and registrations) from `src-tauri/src/lib.rs` and the `load_config`/`save_config` helpers + config tests from the `project_store` module; keep the tasks load/save commands.
- [x] 5.4 Delete the app-level `.agent-desktop/config.json` fixture (git-tracked, now unreferenced).

## 6. Verify

- [x] 6.1 `grep -ri "autoWorktree\|project_config_\|projectFolderConfig\|cleanupWorktree\|worktree_remove_if_clean" src src-tauri` returns no live references (only the intentional legacy strip + archived openspec docs).
- [x] 6.2 Frontend `svelte-check` clean + vitest (1185) pass; `cargo build` + worktree/project_store `cargo test` pass; clippy adds no new warnings in touched files. (Pre-existing `events::tests` socket-path failures are environmental, unrelated.)
- [x] 6.3 `openspec validate remove-auto-worktree --strict` passes.
