import { describe, expect, it, vi, beforeEach } from 'vitest';

// Tests for the one-time user-level → per-project-folder migration
// (project-folder-storage capability). The Tauri `invoke` is mocked and routed
// by command name so we can assert exactly which writes happen.

const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { migrateToProjectFolders } from './migrateProjectFolders';
import { serializeTasks, parseProjectTasks, type TaskDef } from '../tasks/projectTasks';

/** Build a user-level tasks.json envelope keyed by projectId. */
function userTasks(byProject: Record<string, TaskDef[]>): string {
  return serializeTasks(byProject);
}

/** Build a projects.json envelope from raw project records. */
function projectsJson(projects: Record<string, unknown>[]): string {
  return JSON.stringify({ version: 1, projects });
}

function call(cmd: string): [string, unknown][] {
  return invokeMock.mock.calls.filter((c) => c[0] === cmd) as [string, unknown][];
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
});

describe('project-folder-storage — migration', () => {
  it('Tasks migrated to project folder', async () => {
    const tasks: Record<string, TaskDef[]> = {
      p: [
        {
          id: 'a',
          name: 'dev',
          kind: 'terminal',
          command: 'npm run dev',
          cwd: null,
          wasRunning: true,
          lastCommand: 'npm run dev'
        }
      ]
    };
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'tasks_load') return userTasks(tasks);
      if (cmd === 'projects_load') return projectsJson([{ id: 'p', path: '/p', name: 'P' }]);
      return null;
    });

    await migrateToProjectFolders();

    const saves = call('project_tasks_save');
    expect(saves).toHaveLength(1);
    const arg = saves[0][1] as { projectPath: string; json: string };
    expect(arg.projectPath).toBe('/p');
    // Sanitized: restore hints stripped.
    const parsed = parseProjectTasks(arg.json);
    expect(parsed[0]).not.toHaveProperty('wasRunning');
    expect(parsed[0]).not.toHaveProperty('lastCommand');
    expect(parsed[0]).toMatchObject({ id: 'a', command: 'npm run dev' });
    // User-level file deleted.
    expect(call('tasks_clear')).toHaveLength(1);
  });

  it('autoWorktree lifted out of the registry', async () => {
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'tasks_load') return userTasks({ p: [] });
      if (cmd === 'projects_load')
        return projectsJson([{ id: 'p', path: '/p', name: 'P', autoWorktree: true }]);
      return null;
    });

    await migrateToProjectFolders();

    const cfgSaves = call('project_config_save');
    expect(cfgSaves).toHaveLength(1);
    const cfgArg = cfgSaves[0][1] as { projectPath: string; json: string };
    expect(cfgArg.projectPath).toBe('/p');
    expect(JSON.parse(cfgArg.json).autoWorktree).toBe(true);
    // projects_save payload has autoWorktree stripped.
    const projSave = call('projects_save');
    expect(projSave).toHaveLength(1);
    const payload = JSON.parse((projSave[0][1] as { json: string }).json);
    expect(payload.projects[0]).not.toHaveProperty('autoWorktree');
    expect(payload.projects[0]).toMatchObject({ id: 'p', path: '/p' });
  });

  it('Unwritable project skipped', async () => {
    const tasks: Record<string, TaskDef[]> = {
      p: [{ id: 'a', name: 'dev', kind: 'terminal', command: 'x', cwd: null }]
    };
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'tasks_load') return userTasks(tasks);
      if (cmd === 'projects_load')
        return projectsJson([{ id: 'p', path: '/p', name: 'P', autoWorktree: true }]);
      if (cmd === 'project_tasks_save') throw new Error('unwritable folder');
      return null;
    });

    await migrateToProjectFolders();

    // tasks_clear/terminals_clear NOT called because the task write failed: the
    // source files are retained so the next launch retries (and won't clobber any
    // project that already migrated).
    expect(call('tasks_clear')).toHaveLength(0);
    expect(call('terminals_clear')).toHaveLength(0);
    const projSave = call('projects_save');
    expect(projSave).toHaveLength(1);
  });

  it('retains autoWorktree and sources when its config write fails', async () => {
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'tasks_load') return userTasks({});
      if (cmd === 'projects_load')
        return projectsJson([{ id: 'p', path: '/p', name: 'P', autoWorktree: true }]);
      if (cmd === 'project_config_save') throw new Error('unwritable folder');
      return null;
    });

    await migrateToProjectFolders();

    const projSave = call('projects_save');
    const payload = JSON.parse((projSave[0][1] as { json: string }).json);
    // The failed project keeps its autoWorktree for a later retry...
    expect(payload.projects[0].autoWorktree).toBe(true);
    // ...and the user-level sources are NOT cleared, so autoWorktree is never
    // silently lost (regression: cleanup was once gated only on task writes).
    expect(call('tasks_clear')).toHaveLength(0);
    expect(call('terminals_clear')).toHaveLength(0);
  });

  it('Does not clobber an existing per-project file', async () => {
    // A re-run (e.g. after a prior partial failure) must NOT overwrite a project
    // whose `.agent-desktop/tasks.json` already exists — the user may have edited
    // it since. Regression for the partial-failure re-run clobber.
    const tasks: Record<string, TaskDef[]> = {
      p: [{ id: 'a', name: 'old', kind: 'terminal', command: 'stale', cwd: null }]
    };
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'tasks_load') return userTasks(tasks);
      if (cmd === 'projects_load') return projectsJson([{ id: 'p', path: '/p', name: 'P' }]);
      if (cmd === 'project_tasks_load') return '{"version":1,"tasks":[{"id":"a","name":"edited","kind":"terminal","command":"new","cwd":null}]}';
      return null;
    });

    await migrateToProjectFolders();

    // The existing per-project file is left untouched (no overwrite)...
    expect(call('project_tasks_save')).toHaveLength(0);
    // ...and since the project is "secured" (its file exists), cleanup proceeds.
    expect(call('tasks_clear')).toHaveLength(1);
  });

  it('does not clobber an unreadable per-project file', async () => {
    // If project_tasks_load THROWS (existing-but-unreadable file), the migration
    // must NOT fall through to a save that overwrites it; the source is retained.
    const tasks: Record<string, TaskDef[]> = {
      p: [{ id: 'a', name: 'dev', kind: 'terminal', command: 'x', cwd: null }]
    };
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'tasks_load') return userTasks(tasks);
      if (cmd === 'projects_load') return projectsJson([{ id: 'p', path: '/p', name: 'P' }]);
      if (cmd === 'project_tasks_load') throw new Error('permission denied');
      return null;
    });

    await migrateToProjectFolders();

    expect(call('project_tasks_save')).toHaveLength(0); // no clobbering write
    expect(call('tasks_clear')).toHaveLength(0); // source retained for retry
    expect(call('terminals_clear')).toHaveLength(0);
  });

  it('Corrupt registry preserves task data', async () => {
    // If projects.json fails to load / parse (returns null or garbage), every
    // user-level task is "orphaned" — the migration must NOT delete the sources,
    // or it would destroy ALL tasks. Regression for the orphan/corrupt-registry
    // data-loss path.
    const tasks: Record<string, TaskDef[]> = {
      p: [{ id: 'a', name: 'dev', kind: 'terminal', command: 'x', cwd: null }]
    };
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'tasks_load') return userTasks(tasks);
      if (cmd === 'projects_load') return null; // registry unreadable
      return null;
    });

    await migrateToProjectFolders();

    // Nothing written (no project to write to) and NOTHING deleted.
    expect(call('project_tasks_save')).toHaveLength(0);
    expect(call('tasks_clear')).toHaveLength(0);
    expect(call('terminals_clear')).toHaveLength(0);
  });

  it('Existing config preserved', async () => {
    // A teammate-committed `.agent-desktop/config.json` must not be overwritten by
    // a stale `autoWorktree` in projects.json — but the registry field is still
    // stripped (config.json is now the source of truth).
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'tasks_load') return userTasks({});
      if (cmd === 'projects_load')
        return projectsJson([{ id: 'p', path: '/p', name: 'P', autoWorktree: false }]);
      if (cmd === 'project_config_load') return '{"version":1,"autoWorktree":true}';
      return null;
    });

    await migrateToProjectFolders();

    // Committed config left untouched...
    expect(call('project_config_save')).toHaveLength(0);
    // ...registry field stripped anyway.
    const projSave = call('projects_save');
    const payload = JSON.parse((projSave[0][1] as { json: string }).json);
    expect(payload.projects[0]).not.toHaveProperty('autoWorktree');
  });

  it('Idempotent', async () => {
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'tasks_load') return null;
      if (cmd === 'terminals_load') return null;
      return null;
    });

    await migrateToProjectFolders();

    expect(call('project_tasks_save')).toHaveLength(0);
    expect(call('project_config_save')).toHaveLength(0);
    expect(call('projects_save')).toHaveLength(0);
    expect(call('tasks_clear')).toHaveLength(0);
  });

  it('Legacy source cleared', async () => {
    // Falls back to the legacy terminals.json when tasks.json is absent, AND
    // clears that legacy source so it cannot re-fire the migration.
    const legacy = serializeTasks({
      p: [{ id: 'a', name: 'dev', kind: 'terminal', command: 'npm run dev', cwd: null }]
    });
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'tasks_load') return null;
      if (cmd === 'terminals_load') return legacy;
      if (cmd === 'projects_load') return projectsJson([{ id: 'p', path: '/p', name: 'P' }]);
      return null;
    });

    await migrateToProjectFolders();

    expect(call('project_tasks_save')).toHaveLength(1);
    expect(call('tasks_clear')).toHaveLength(1);
    // The legacy source MUST also be cleared, else it re-fires every launch.
    expect(call('terminals_clear')).toHaveLength(1);
  });

  it('does not re-migrate from legacy terminals.json after cleanup', async () => {
    // Regression for the idempotency bug: the legacy `terminals.json` is the
    // fallback source, so if it is not cleared the migration re-runs on every
    // launch and overwrites/resurrects per-project `.agent-desktop` data. Here a
    // STATEFUL mock makes `terminals_clear` actually empty the legacy source, then
    // we run the migration a SECOND time and assert it writes nothing.
    let terminalsPresent = serializeTasks({
      p: [{ id: 'a', name: 'dev', kind: 'terminal', command: 'npm run dev', cwd: null }]
    }) as string | null;
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'tasks_load') return null;
      if (cmd === 'terminals_load') return terminalsPresent;
      if (cmd === 'projects_load') return projectsJson([{ id: 'p', path: '/p', name: 'P' }]);
      if (cmd === 'terminals_clear') {
        terminalsPresent = null; // the cleanup actually removes the legacy file
        return null;
      }
      return null;
    });

    await migrateToProjectFolders(); // run 1: migrates from legacy, clears it
    expect(call('project_tasks_save')).toHaveLength(1);
    expect(call('terminals_clear')).toHaveLength(1);

    invokeMock.mockClear();
    await migrateToProjectFolders(); // run 2: both sources null → pure no-op

    expect(call('project_tasks_save')).toHaveLength(0);
    expect(call('project_config_save')).toHaveLength(0);
    expect(call('projects_save')).toHaveLength(0);
    expect(call('tasks_clear')).toHaveLength(0);
  });
});
