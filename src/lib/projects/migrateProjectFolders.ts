// One-time migration from USER-LEVEL storage to PER-PROJECT folders
// (project-folder-storage capability). The legacy model kept ALL projects'
// terminals in a single user-level `tasks.json` (keyed by projectId). This moves
// each project's tasks into `<project>/.agent-desktop/tasks.json` (SANITIZED — no
// machine-local restore hints), then deletes the user-level copies.
//
// Resilience + idempotency:
//   - A project whose folder is unwritable is SKIPPED (its user-level data is
//     left in place so a later run can retry); the user-level tasks file is
//     deleted only when EVERY project that had tasks was written successfully.
//   - After a successful run the user-level `tasks.json` is gone, so the next run
//     reads null from both `tasks_load`/`terminals_load` and returns immediately.
//   - The whole body is wrapped so it NEVER throws — a migration failure must not
//     block app start.

import { invoke } from '@tauri-apps/api/core';
import { parseTasks, serializeProjectTasks } from '../tasks/projectTasks';

/** Parse `projects.json` (envelope or bare array) into raw `{id, path, ...}`
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

    // 3. Recover the raw projects list to map each projectId → folder path.
    let projectsRaw: string | null = null;
    try {
      projectsRaw = await invoke<string | null>('projects_load');
    } catch (err) {
      console.error('migrate: projects_load failed', err);
    }
    const rawProjects = parseRawProjects(projectsRaw);

    // 4. Write each project's tasks. We NEVER overwrite an existing per-project
    //    file (a prior run, or a teammate-committed file, may hold newer data) —
    //    an existing file counts as already-migrated. `securedTasks` tracks the
    //    projectIds whose user-level tasks are safely in a per-project file
    //    (written now OR already present).
    const securedTasks = new Set<string>();

    for (const rp of rawProjects) {
      const id = typeof rp.id === 'string' ? rp.id : '';
      const path = typeof rp.path === 'string' ? rp.path : '';
      if (!id || !path) continue;

      const tasks = byProject[id];
      if (tasks && tasks.length > 0) {
        let existing: string | null = null;
        let loadOk = true;
        try {
          existing = await invoke<string | null>('project_tasks_load', { projectPath: path });
        } catch (err) {
          // An existing-but-unreadable file surfaces as Err (not null). Do NOT
          // fall through to a save that could clobber it — leave the project
          // unsecured so the user-level source is retained for a later run.
          loadOk = false;
          console.error('migrate: project_tasks_load failed', id, err);
        }
        if (existing != null) {
          securedTasks.add(id); // already migrated — do NOT clobber newer data.
        } else if (loadOk) {
          try {
            await invoke('project_tasks_save', {
              projectPath: path,
              json: serializeProjectTasks(tasks)
            });
            securedTasks.add(id);
          } catch (err) {
            console.error('migrate: project_tasks_save failed', id, err);
            // NOT secured → the user-level source is retained (step 5).
          }
        }
      }
    }

    // 5. Delete BOTH user-level source files ONLY when migration is COMPLETE:
    //    every user-level task projectId is secured in a per-project file. This
    //    guards two data-loss paths:
    //      - a partial write failure (some project unwritable) keeps the sources
    //        so the next launch retries — and step 4 won't clobber the projects
    //        that already migrated;
    //      - tasks whose project is missing from `projects.json` (a removed
    //        project, or a transiently corrupt/empty `projects.json`) are never
    //        "secured", so the sources are NOT deleted — no destruction.
    //    Clearing the legacy `terminals.json` too is essential for idempotency:
    //    it is the fallback source (step 1), so leaving it would re-fire the
    //    migration forever. With both gone, the next run reads null from both.
    const taskProjectIds = Object.keys(byProject).filter((id) => (byProject[id]?.length ?? 0) > 0);
    const unsecured = taskProjectIds.filter((id) => !securedTasks.has(id));
    const complete = unsecured.length === 0;
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
        unsecuredTaskProjects: unsecured
      });
    }
  } catch (err) {
    // Never let migration block app start.
    console.error('migrateToProjectFolders failed', err);
  }
}
