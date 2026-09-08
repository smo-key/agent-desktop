## Context

Auto-worktree spans the full session lifecycle and two capabilities:

- **Launch** (`launcher/newSession.ts`): reads `autoWorktree` via
  `projectFolderConfig.loadAutoWorktree`, calls `launcher/worktree.createWorktree`,
  and threads `worktreePath`/`worktreeBase` into `buildLaunchPlan`.
- **Close** (`layout/workspace.svelte.ts`): `cleanupWorktree` calls
  `worktree_remove_if_clean` on permanent close (not on archive).
- **Config storage** (`project-folder-storage`): `autoWorktree` is the sole field
  of the per-project `.agent-desktop/config.json` envelope, with `ProjectConfig`
  parse/serialize in `tasks/projectTasks.ts`, `project_config_load/save` Rust
  commands, and an `autoWorktree` lift in `migrateProjectFolders.ts`.

The manual worktree view (`WorktreeDialog.svelte`, `worktreePanel.svelte.ts`) and
its commands (`worktree_create`, `worktree_list`, `worktree_remove`) are separate
and stay.

## Goals / Non-Goals

**Goals:**
- Remove the `autoWorktree` setting, its form toggle, the launch-time auto-create
  path, and the close-time auto-cleanup path.
- Remove the `.agent-desktop/config.json` scaffolding (envelope, commands, helpers,
  migration lift) since `autoWorktree` was its only field.
- Leave the manual worktree tooling and all of `.agent-desktop/tasks.json`
  storage/migration untouched and green.

**Non-Goals:**
- Removing or altering manual worktree create/list/prune.
- Migrating or deleting existing `config.json` files on disk (they become inert).
- Touching `tasks.json` storage, sanitization, or restore behavior.

## Decisions

- **Drop `worktreePath`/`worktreeBase` from the launch pipeline.** `worktreeBase`
  existed only so close-time cleanup could decide cleanliness; with cleanup gone it
  has no consumer. The manual "open into worktree" flow runs a session whose
  working directory IS the worktree path, so it goes through the normal `folder`
  field — no dedicated `worktreePath` on `PaneSession`/`LaunchPlan`/`LaunchRequest`
  is needed. Remove all three fields and `cleanupWorktree`; verify the manual
  `worktreePanel.open()` still launches by passing the worktree path as `folder`.
  _Alternative considered_: keep `worktreePath` as a generic field — rejected as
  dead weight once nothing reads it.
- **Leftover persisted data is inert; records get a one-line legacy strip.** Stale
  `autoWorktree` keys in `projects.json` or existing `config.json` files are never
  read again. We remove `ProjectDraft.autoWorktree`, but KEEP the one-line
  `delete …autoWorktree` in `normalize()`: `Project` records are reconstructed via
  object spread, which preserves stray keys, so without the strip a legacy
  `autoWorktree` would round-trip back into `projects.json`. The strip (reworded as
  a legacy cleanup) actively tidies old records and keeps a passing regression test.
  Existing `config.json` files are left on disk inert. _Alternative_: drop the strip
  too — rejected because spread would otherwise re-persist the stale field.
- **Keep `worktree_create` and `ensure_worktrees_ignored` in Rust.** `worktree_create`
  is retained per scope (manual use); `ensure_worktrees_ignored` is its helper.
  Only `worktree_remove_if_clean` (auto cleanup) and the `project_config_load/save`
  commands + `project_store` config helpers are removed.
- **Trim, don't delete, shared test files.** `projectTasks.test.ts`,
  `projects.test.ts`, `migrateProjectFolders.test.ts`, and `workspace.svelte.test.ts`
  cover more than auto-worktree; remove only the auto-worktree cases. Fully delete
  `launcher/worktree.ts` + `worktree.test.ts` and `projects/projectFolderConfig.ts`.

## Risks / Trade-offs

- [A user previously enabled `autoWorktree` and expects new worktrees per session]
  → Behavior changes: sessions now run in the project path. This is the intended
  BREAKING change; the manual worktree view remains for those who want isolation.
- [`migrateProjectFolders.ts` still references the removed `config.json` path] →
  Trim the `autoWorktree` lift/strip carefully so the tasks migration and its
  idempotency (deleting both source files) stay intact; covered by retained tests.
- [Dangling Rust symbols after command removal] → `cargo build`/`clippy` must pass;
  remove now-unused structs (`WorktreeRemoval`) and helpers only if no longer
  referenced by the retained manual commands.

## Migration Plan

No runtime migration. Inert `config.json` files and stale `autoWorktree` registry
fields are ignored. Rollback is a straight revert of this change.
