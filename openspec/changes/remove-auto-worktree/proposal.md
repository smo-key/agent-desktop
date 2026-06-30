## Why

The per-project auto-worktree feature adds meaningful surface area — a project
setting, a folder-config storage envelope, a launch-time creation path, and a
close-time cleanup path — for behavior that has not earned its keep. Removing it
shrinks the launch/close lifecycle and the project-folder-storage capability to
only what is actually used, while preserving the manual worktree tooling that
remains useful on its own.

## What Changes

- **BREAKING**: Remove the per-project `autoWorktree` setting and its toggle in
  the project create/edit form. Projects no longer opt into automatic worktrees.
- Remove launch-time auto-creation: launching a session always uses the project
  path; sessions are no longer redirected into a freshly created worktree.
- Remove close-time auto-cleanup: permanently closing a session no longer
  evaluates or removes a per-session worktree (`worktree_remove_if_clean` and the
  `cleanupWorktree` path go away). Manual pruning via the worktree view remains.
- **KEEP** the manual worktree tooling: the "Worktrees…" management view
  (`WorktreeDialog` / `worktreePanel`) and the `worktree_create`, `worktree_list`,
  and `worktree_remove` backend commands stay, so users can still create, open,
  and prune worktrees by hand.
- Remove the per-project `.agent-desktop/config.json` folder-config scaffolding
  entirely — `autoWorktree` was its only field. The `project_config_load` /
  `project_config_save` commands, the `ProjectConfig` parse/serialize helpers,
  the `projectFolderConfig` helpers, and the `autoWorktree` lift in the
  project-folder migration are removed. The `.agent-desktop/tasks.json` half of
  project-folder storage is unaffected.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `project-worktrees`: Remove the four auto-worktree requirements (per-project
  setting, auto-create on launch, fallback on failure, conditional cleanup on
  close). Retain only the manual "Manage a project's worktrees" requirement.
- `project-folder-storage`: Remove the `config.json` file-format requirement and
  the `autoWorktree` portions of the storage-directory, persistence-commands, and
  migration requirements. The `tasks.json` storage, persistence, sanitization,
  and migration behavior are retained unchanged.

## Impact

- Frontend: `ProjectForm.svelte` (toggle), `ProjectPanel.svelte` (save path),
  `launcher/newSession.ts` AND `launcher/Launcher.svelte` (auto-create check),
  `launcher/plan.ts`
  (`worktreePath`/`worktreeBase` carry-through), `layout/workspace.svelte.ts`
  (`PaneSession` worktree fields + `cleanupWorktree`), and removal of
  `launcher/worktree.ts` and `projects/projectFolderConfig.ts`.
- Persistence: `projects.ts` `ProjectDraft.autoWorktree`; `tasks/projectTasks.ts`
  `ProjectConfig` parse/serialize; `projects/migrateProjectFolders.ts`
  `autoWorktree` lift/strip.
- Backend (Rust): remove `worktree_remove_if_clean` (the auto close-time
  cleanup) and the `project_config_load` / `project_config_save` commands plus
  their `project_store` config helpers. Keep `worktree_create`, `worktree_list`,
  `worktree_remove`, and the supporting git helpers for the manual view.
- Tests: remove/trim auto-worktree-specific tests (`worktree.test.ts`,
  config round-trip in `projectTasks.test.ts`, `migrateProjectFolders.test.ts`
  autoWorktree cases, `workspace` cleanup-on-close cases, `projects.test.ts`
  strip case); keep manual-worktree tests.
