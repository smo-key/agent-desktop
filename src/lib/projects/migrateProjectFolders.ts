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

    // 4. Write each project's tasks + config, tracking per-project success.
    let allTaskWritesOk = true; // true ⇒ safe to delete the user-level tasks file
    // projectId → migrated-ok (its autoWorktree can be stripped from projects.json)
    const configMigrated = new Set<string>();

    for (const rp of rawProjects) {
      const id = typeof rp.id === 'string' ? rp.id : '';
      const path = typeof rp.path === 'string' ? rp.path : '';
      const autoWorktree = rp.autoWorktree;
      if (!id || !path) continue;
      let configOk = true;

      const tasks = byProject[id];
      if (tasks && tasks.length > 0) {
        try {
          await invoke('project_tasks_save', {
            projectPath: path,
            json: serializeProjectTasks(tasks)
          });
        } catch (err) {
          console.error('migrate: project_tasks_save failed', id, err);
          allTaskWritesOk = false;
        }
      }

      if (typeof autoWorktree === 'boolean') {
        try {
          await invoke('project_config_save', {
            projectPath: path,
            json: serializeProjectConfig({ autoWorktree })
          });
        } catch (err) {
          console.error('migrate: project_config_save failed', id, err);
          configOk = false;
        }
      }
      if (configOk) configMigrated.add(id);
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

    // 6. Delete the user-level tasks file ONLY when every task write succeeded.
    if (allTaskWritesOk) {
      try {
        await invoke('tasks_clear');
      } catch (err) {
        console.error('migrate: tasks_clear failed', err);
      }
    }
  } catch (err) {
    // Never let migration block app start.
    console.error('migrateToProjectFolders failed', err);
  }
}
