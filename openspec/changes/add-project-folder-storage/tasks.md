# Tasks — add-project-folder-storage

## 1. Backend: project-folder store (Rust)
- [ ] 1.1 Add a `project_store` module mirroring `specialists.rs`: pure core over
  `project_path: &Path` resolving `<project>/.agent-desktop/{tasks,config}.json`,
  with read-or-`None`, atomic tmp+rename write, and create-dir-on-write. Unit
  tests (temp dir): missing file → `None`; write then read round-trips; atomic
  write leaves no `.tmp`.
- [ ] 1.2 Add `#[tauri::command]` wrappers in `lib.rs`:
  `project_tasks_load/save`, `project_config_load/save` (by project path).
  Register them in the invoke handler.
- [ ] 1.3 Add a command to clear the legacy user-level `tasks.json`
  (`tasks_clear` / delete) used by the migration's destructive step. Deleting an
  absent file is a no-op.

## 2. Frontend model: per-project tasks serialization (pure)
- [ ] 2.1 In `projectTasks.ts`, add `serializeProjectTasks(defs)` →
  `{ version, tasks }` that STRIPS `wasRunning`/`lastCommand` and drops empty
  arrays; add `parseProjectTasks(raw)` → `TaskDef[]` (tolerant, never throws).
  Unit tests: hints stripped; `cwd`/`closeOnComplete` retained; bad input → `[]`.
- [ ] 2.2 Add a per-project config model: `parseProjectConfig(raw)` /
  `serializeProjectConfig({ autoWorktree })` → `{ version, autoWorktree? }`
  (absent ⇒ `false`). Unit tests for round-trip + defaults.

## 3. Frontend store: path-aware load/save + resilience
- [ ] 3.1 Inject a `projectId → path` resolver into `ProjectTasksStore` (a setter
  like `setAgentLauncher`), keeping the store free of a direct projects-store
  import. Wire it from the app where the store is initialized.
- [ ] 3.2 Rewrite `load()` to iterate known projects and call
  `project_tasks_load(path)` per project, merging into `byProject`; load each
  project's `config.json` into a cached `configByProject`. Remove the global
  `tasks_load` happy path (kept only for migration — task 4).
- [ ] 3.3 Rewrite `save()` to write ONLY the mutated project's file via
  `project_tasks_save(path, serializeProjectTasks(defs))`. Catch failures: keep
  in-memory state, mark the project dirty, retry on the next save (resilience).
  Unit/store tests: save failure preserves state; retry flushes.
- [ ] 3.4 Drop persisted auto-restart: `autoRestartIds` finds nothing after
  load (hints no longer persisted); terminals restore as stopped. Make
  `captureRunningAndSave()` a no-op for restart purposes (no hint persistence).
  Update store tests accordingly.

## 4. One-time migration + destructive cleanup
- [ ] 4.1 On `load()`, detect first-run (no `.agent-desktop/tasks.json` for known
  projects AND a user-level `tasks.json`/legacy `terminals.json` present). Migrate
  each writable project's tasks → `.agent-desktop/tasks.json` (sanitized) and lift
  `autoWorktree` (from the registry) → `.agent-desktop/config.json`.
- [ ] 4.2 After all resolvable+writable projects migrate, delete user-level
  `tasks.json` (task 1.3) and strip `autoWorktree` from every project in
  `projects.json` (projects-store save after dropping the field). Skip unwritable
  projects (leave their user-level data; don't delete). Idempotent thereafter.
- [ ] 4.3 Tests: tasks land in project folders + user-level deleted;
  `autoWorktree` lifted + registry field stripped; unwritable project skipped &
  user-level retained; second run is a no-op.

## 5. autoWorktree off the registry record
- [ ] 5.1 Remove `autoWorktree` from the `Project` persisted envelope:
  `projects.ts` `normalize()` strips it on load; the interface field is removed
  (or marked migration-only). Update `projects` unit tests.
- [ ] 5.2 `ProjectForm.svelte`: bind the auto-worktree toggle to the project-folder
  config — seed from `configByProject`/`project_config_load(path)`, persist via
  `project_config_save(path, ...)` (and update the store cache) on save instead of
  writing the project record.
- [ ] 5.3 Session-launch path: read `autoWorktree` from the cached project-folder
  config (not the project record). Update any consumer found via
  `grep autoWorktree`.

## 6. Verify
- [ ] 6.1 `cargo test` (Rust) and the JS unit/store tests all green.
- [ ] 6.2 `npm run check` / typecheck clean; `openspec validate
  add-project-folder-storage --strict` passes.
- [ ] 6.3 Manual smoke (or `/run`): create a task in a project → it appears under
  `<project>/.agent-desktop/tasks.json` with no restore hints; toggle
  auto-worktree → lands in `config.json`, gone from `projects.json`; relaunch →
  terminals come back stopped; migration moves pre-existing user-level data once.
