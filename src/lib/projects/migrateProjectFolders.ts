// One-time migration from USER-LEVEL storage to PER-PROJECT folders
// (project-folder-storage capability). The legacy model kept ALL projects'
// terminals in a single user-level `tasks.json` (keyed by projectId) and the
// per-project `autoWorktree` flag on each Project record in `projects.json`.
// This moves each project's tasks into `<project>/.agent-desktop/tasks.json`
// (SANITIZED — no machine-local restore hints) and its `autoWorktree` into
// `<project>/.agent-desktop/config.json`, then deletes the user-level copies.
//
// Resilience + idempotency:
//   - A project whose folder is unwritable is SKIPPED (its user-level data is
//     left in place so a later run can retry); only the user-level tasks file is
//     deleted when EVERY project that had tasks was written successfully.
//   - `autoWorktree` is stripped from a project in `projects.json` ONLY once that
//     project's config write succeeds, so a failed project retries next run.
//   - After a successful run the user-level `tasks.json` is gone, so the next run
//     reads null from both `tasks_load`/`terminals_load` and returns immediately.
//   - The whole body is wrapped so it NEVER throws — a migration failure must not
//     block app start.

import { invoke } from '@tauri-apps/api/core';
import { parseTasks, serializeProjectTasks, serializeProjectConfig } from '../tasks/projectTasks';

/** One project's raw fields recovered DIRECTLY from `projects.json` (NOT via
 *  `parseProjects`, which now strips `autoWorktree`). */
interface RawProject {
  id: string;
  path: string;
  autoWorktree?: boolean;
}

/** Parse `projects.json` (envelope or bare array) into raw `{id, path, autoWorktree, ...}`
 *  records, preserving every field. ANY failure ⇒ `[]`. */
function parseRawProjects(raw: string | null): Record<string, unknown>[] {
  try {
    if (raw == null || raw.trim() === '') return [];
    const parsed: unknown = JSON.parse(raw);
    const arr = Array.isArray(parsed)
      ? parsed
      : parsed !== null &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { projects?: unknown }).projects)
        ? (parsed as { projects: unknown[] }).projects
        : [];
    return arr.filter(
      (p): p is Record<string, unknown> => p !== null && typeof p === 'object' && !Array.isArray(p)
    );
  } catch {
    return [];
  }
}

/**
 * Run the one-time user-level → per-project-folder migration. Safe to call on
 * every app start: a no-op once the user-level data is gone. NEVER throws.
 */
export async function migrateToProjectFolders(): Promise<void> {
  try {
    // 1. Recover the user-level tasks (current `tasks.json`, else legacy `terminals.json`).
    let userTasksRaw: string | null = null;
    try {
      userTasksRaw = await invoke<string | null>('tasks_load');
    } catch (err) {
      console.error('migrate: tasks_load failed', err);
    }
    let legacyRaw: string | null = null;
    if (userTasksRaw == null) {
      try {
        legacyRaw = await invoke<string | null>('terminals_load');
      } catch (err) {
        console.error('migrate: terminals_load failed', err);
      }
    }
    // Idempotency: after a prior successful run the user-level file is gone.
    if (userTasksRaw == null && legacyRaw == null) return;

    // 2. Per-project task collections (sanitized on serialize).
    const byProject = parseTasks(userTasksRaw ?? legacyRaw);

    // 3. Recover the raw projects list (to read `autoWorktree`, which the projects
    //    parser now strips). Read DIRECTLY, tolerating envelope or bare array.
    let projectsRaw: string | null = null;
    try {
      projectsRaw = await invoke<string | null>('projects_load');
    } catch (err) {
      console.error('migrate: projects_load failed', err);
    }
    const rawProjects = parseRawProjects(projectsRaw);

    // 4. Write each project's tasks + config. We NEVER overwrite an existing
    //    per-project file (a prior run, or a teammate-committed file, may hold
    //    newer data) — an existing file counts as already-migrated. We track:
    //      - `securedTasks`: projectIds whose user-level tasks are safely in a
    //        per-project file (written now OR already present).
    //      - `configMigrated`: projectIds whose `autoWorktree` is now in their
    //        config file (or already was) → safe to strip from `projects.json`.
    //      - `allConfigWritesOk`: false if ANY config write failed.
    const securedTasks = new Set<string>();
    const configMigrated = new Set<string>();
    let allConfigWritesOk = true;

    for (const rp of rawProjects) {
      const id = typeof rp.id === 'string' ? rp.id : '';
      const path = typeof rp.path === 'string' ? rp.path : '';
      const autoWorktree = rp.autoWorktree;
      if (!id || !path) continue;

      const tasks = byProject[id];
      if (tasks && tasks.length > 0) {
        let existing: string | null = null;
        try {
          existing = await invoke<string | null>('project_tasks_load', { projectPath: path });
        } catch (err) {
          console.error('migrate: project_tasks_load failed', id, err);
        }
        if (existing != null) {
          securedTasks.add(id); // already migrated — do NOT clobber newer data.
        } else {
          try {
            await invoke('project_tasks_save', {
              projectPath: path,
              json: serializeProjectTasks(tasks)
            });
            securedTasks.add(id);
          } catch (err) {
            console.error('migrate: project_tasks_save failed', id, err);
            // NOT secured → the user-level source is retained (step 6).
          }
        }
      }

      if (typeof autoWorktree === 'boolean') {
        let existingCfg: string | null = null;
        try {
          existingCfg = await invoke<string | null>('project_config_load', { projectPath: path });
        } catch (err) {
          console.error('migrate: project_config_load failed', id, err);
        }
        if (existingCfg != null) {
          configMigrated.add(id); // committed/earlier config wins — don't clobber.
        } else {
          try {
            await invoke('project_config_save', {
              projectPath: path,
              json: serializeProjectConfig({ autoWorktree })
            });
            configMigrated.add(id);
          } catch (err) {
            console.error('migrate: project_config_save failed', id, err);
            allConfigWritesOk = false; // keep autoWorktree in projects.json; retry later.
          }
        }
      } else {
        configMigrated.add(id); // nothing to migrate for this project.
      }
    }

    // 5. Re-save projects.json with `autoWorktree` stripped from MIGRATED projects
    //    only (a project whose config write failed keeps it for a later retry).
    const newList = rawProjects.map((rp) => {
      const id = typeof rp.id === 'string' ? rp.id : '';
      if (configMigrated.has(id) && 'autoWorktree' in rp) {
        const { autoWorktree: _drop, ...rest } = rp as RawProject & Record<string, unknown>;
        return rest;
      }
      return rp;
    });
    try {
      await invoke('projects_save', { json: JSON.stringify({ version: 1, projects: newList }) });
    } catch (err) {
      console.error('migrate: projects_save failed', err);
    }

    // 6. Delete BOTH user-level source files ONLY when migration is COMPLETE:
    //    every user-level task projectId is secured in a per-project file AND no
    //    config write failed. This guards three data-loss paths:
    //      - a partial write failure (some project unwritable) keeps the sources
    //        so the next launch retries — and step 4 won't clobber the projects
    //        that already migrated;
    //      - a failed config write keeps the sources so `autoWorktree` is retried
    //        (it is NOT silently lost);
    //      - tasks whose project is missing from `projects.json` (a removed
    //        project, or a transiently corrupt/empty `projects.json`) are never
    //        "secured", so the sources are NOT deleted — no destruction.
    //    Clearing the legacy `terminals.json` too is essential for idempotency:
    //    it is the fallback source (step 1), so leaving it would re-fire the
    //    migration forever. With both gone, the next run reads null from both.
    const taskProjectIds = Object.keys(byProject).filter((id) => (byProject[id]?.length ?? 0) > 0);
    const unsecured = taskProjectIds.filter((id) => !securedTasks.has(id));
    const complete = unsecured.length === 0 && allConfigWritesOk;
    if (complete) {
      try {
        await invoke('tasks_clear');
      } catch (err) {
        console.error('migrate: tasks_clear failed', err);
      }
      try {
        await invoke('terminals_clear');
      } catch (err) {
        console.error('migrate: terminals_clear failed', err);
      }
    } else {
      console.warn('migrate: incomplete — user-level sources retained for retry', {
        unsecuredTaskProjects: unsecured,
        allConfigWritesOk
      });
    }
  } catch (err) {
    // Never let migration block app start.
    console.error('migrateToProjectFolders failed', err);
  }
}
