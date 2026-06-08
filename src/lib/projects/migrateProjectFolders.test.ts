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

    // tasks_clear NOT called because a task write failed.
    expect(call('tasks_clear')).toHaveLength(0);
    // autoWorktree config write also fails for an unwritable folder; assert it is
    // retained in projects.json so a later run retries.
    // (config_save also rejects here is not set up; simulate via the same reject.)
    const projSave = call('projects_save');
    expect(projSave).toHaveLength(1);
  });

  it('retains autoWorktree in projects.json when its config write fails', async () => {
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
    // The failed project keeps its autoWorktree for a later retry.
    expect(payload.projects[0].autoWorktree).toBe(true);
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

  it('falls back to the legacy terminals.json when tasks.json is absent', async () => {
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
  });
});
