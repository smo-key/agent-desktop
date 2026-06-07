import { describe, expect, it, vi } from 'vitest';

// ProjectTasksStore tests. Named `*.svelte.test.ts` so vitest compiles the
// store's `$state` runes. Titles match the project-terminals + terminals-panel
// `#### Scenario:` names for the runtime-lifecycle + running-indicator behaviors
// (the pure model is covered separately in projectTasks.test.ts). The Tauri
// `invoke` is mocked — these assert the store's in-memory lifecycle, not I/O.

const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { ProjectTasksStore } from './projectTasks.svelte';
import {
  serializeTasks,
  parseTasks,
  captureRunningState,
  addTask,
  type TaskDef
} from './projectTasks';

describe('project-terminals — runtime lifecycle', () => {
  it('Start a stopped terminal', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm run dev' });
    store.startTask(id);
    store.stop(id);
    expect(store.isRunning(id)).toBe(false);
    store.start(id);
    expect(store.isRunning(id)).toBe(true);
  });

  it('Stop a running terminal', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm run dev' });
    store.startTask(id);
    expect(store.isRunning(id)).toBe(true);
    store.stop(id);
    expect(store.isRunning(id)).toBe(false);
    // The slot remains in the collection (stopping does not remove it).
    expect(store.forProject('p').some((t) => t.id === id)).toBe(true);
  });

  it('Restart a terminal', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm run dev' });
    store.startTask(id);
    const firstPane = store.runtime[id].paneId;
    store.restart(id);
    expect(store.isRunning(id)).toBe(true);
    // A fresh pane id forces the `{#key}` to remount → a new PTY spawns.
    expect(store.runtime[id].paneId).not.toBe(firstPane);
  });

  it('Process exiting on its own marks the terminal stopped', async () => {
    const store = new ProjectTasksStore();
    // A bare (no-command) terminal stays as a stopped slot on exit (no auto-close).
    const id = await store.create('p', { kind: 'terminal' });
    store.startTask(id);
    store.noteExit(id, 137);
    expect(store.isRunning(id)).toBe(false);
    expect(store.runtime[id].exitCode).toBe(137);
    // Not removed: the slot stays so the user can restart it.
    expect(store.forProject('p').some((t) => t.id === id)).toBe(true);
  });

  it('remove drops the slot and stops its process', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'x' });
    store.startTask(id);
    await store.remove(id);
    expect(store.forProject('p')).toEqual([]);
    expect(store.runtime[id]).toBeUndefined();
  });
});

describe('project-terminals — restore with running command', () => {
  it('Restored terminal re-runs its last running command', async () => {
    // Build a persisted state where terminal 'a' was running `npm run dev` at quit.
    let map = addTask({}, 'p', {
      id: 'a',
      name: 'zsh',
      kind: 'terminal',
      command: null,
      cwd: null
    });
    map = captureRunningState(map, { a: { running: true, title: 'npm run dev' } });
    const json = serializeTasks(map);
    invokeMock.mockImplementationOnce(async () => json); // tasks_load returns it

    const store = new ProjectTasksStore();
    await store.load();

    // It auto-restarted (running) and queued the command as initial input.
    expect(store.isRunning('a')).toBe(true);
    expect(store.runtime['a'].initialInput).toBe('npm run dev');
  });

  it('restores a plain shell when nothing was running', async () => {
    let map = addTask({}, 'p', { id: 'a', name: 'zsh', kind: 'terminal', command: null, cwd: null });
    map = captureRunningState(map, { a: { running: false } });
    invokeMock.mockImplementationOnce(async () => serializeTasks(map));

    const store = new ProjectTasksStore();
    await store.load();
    // Not running, nothing queued.
    expect(store.isRunning('a')).toBe(false);
  });
});

describe('terminals-panel — running indicator', () => {
  it('Indicator reflects running processes while hidden', async () => {
    const store = new ProjectTasksStore();
    store.startTask(await store.create('p', { kind: 'terminal', command: 'a' }));
    store.startTask(await store.create('p', { kind: 'terminal', command: 'b' }));
    // The count is panel-visibility independent (it is pure store state).
    expect(store.runningCount).toBe(2);
  });

  it('Indicator clears when nothing runs', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'a' });
    store.startTask(id);
    store.stop(id);
    expect(store.runningCount).toBe(0);
  });

  it('counts running terminals across projects', async () => {
    const store = new ProjectTasksStore();
    store.startTask(await store.create('web', { kind: 'terminal', command: 'a' }));
    store.startTask(await store.create('api', { kind: 'terminal', command: 'b' }));
    expect(store.runningCount).toBe(2);
  });
});

describe('project-terminals — terminal title', () => {
  it('Terminal title reflects the running command', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal' }); // empty shell
    store.startTask(id);
    const def = store.forProject('p')[0];
    // Before any title escape, the name falls back to the shell basename.
    expect(store.displayName(def)).toBe(store.shell.split('/').pop());
    // An OSC title (the running command) overrides the display name.
    store.noteTitle(id, 'vim README.md');
    expect(store.displayName(def)).toBe('vim README.md');
  });

  it('ignores empty titles and keeps the last non-empty one', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal' });
    store.startTask(id);
    store.noteTitle(id, 'npm run dev');
    store.noteTitle(id, '   ');
    expect(store.displayName(store.forProject('p')[0])).toBe('npm run dev');
  });

  it('A created shell terminal is named after the shell', async () => {
    const store = new ProjectTasksStore();
    await store.create('p', { kind: 'terminal' });
    expect(store.forProject('p')[0].name).toBe(store.shell.split('/').pop());
  });

  it('Falls back to the shell name with no reported title', async () => {
    const store = new ProjectTasksStore();
    await store.create('p', { kind: 'terminal' });
    // No noteTitle() called → displayName is the shell basename.
    expect(store.displayName(store.forProject('p')[0])).toBe(store.shell.split('/').pop());
  });
});

describe('project-tasks — persistence & lifecycle', () => {
  it('Round-trip persistence', async () => {
    const store = new ProjectTasksStore();
    invokeMock.mockClear();
    const t1 = await store.create('p', { kind: 'terminal', command: 'npm run dev' });
    const t2 = await store.create('p', { kind: 'agent', prompt: 'fix the bug' });

    // The last tasks_save call carries a serialized envelope that re-parses to the
    // exact current defs.
    const saveCalls = invokeMock.mock.calls.filter((c) => c[0] === 'tasks_save');
    expect(saveCalls.length).toBeGreaterThan(0);
    const lastSave = saveCalls[saveCalls.length - 1];
    const json = (lastSave[1] as { json: string }).json;
    const reparsed = parseTasks(json);
    expect(reparsed).toEqual({ p: [store.defForId(t1), store.defForId(t2)] });
  });

  it('Start a task', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm run dev' });
    expect(store.runtime[id]).toBeUndefined(); // create does not auto-start
    store.startTask(id);
    expect(store.isRunning(id)).toBe(true);
    expect(store.runtime[id].paneId).toBeTruthy();
  });

  it('Stop a running task', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm run dev' });
    store.startTask(id);
    store.stop(id);
    expect(store.isRunning(id)).toBe(false);
  });

  it('Restart allocates a fresh pane', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm run dev' });
    store.startTask(id);
    const first = store.runtime[id].paneId;
    store.restart(id);
    expect(store.runtime[id].paneId).not.toBe(first);
  });

  it('Success auto-closes', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm test' });
    store.startTask(id);
    store.noteExit(id, 0);
    // A clean exit of a command task removes its pane (no right-panel slot).
    expect(store.runtime[id]).toBeUndefined();
    // The def stays as an idle task.
    expect(store.forProject('p').some((t) => t.id === id)).toBe(true);
  });

  it('Error keeps pane open and marks failed', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm test' });
    store.startTask(id);
    store.noteExit(id, 1);
    expect(store.runtime[id]).toBeDefined();
    expect(store.runtime[id].running).toBe(false);
    expect(store.runtime[id].exitCode).toBe(1);
    expect(store.isFailed(id)).toBe(true);
  });

  it('Dismiss a failed task', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm test' });
    store.startTask(id);
    store.noteExit(id, 1);
    store.dismiss(id);
    expect(store.runtime[id]).toBeUndefined();
    // The def remains in the project.
    expect(store.forProject('p').some((t) => t.id === id)).toBe(true);
  });

  it('Long-runner persists', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm run dev' });
    store.startTask(id);
    // No exit reported → stays running with a live pane.
    expect(store.runtime[id]).toBeDefined();
    expect(store.runtime[id].running).toBe(true);
  });

  it('No-command terminal exit zero stays stopped', async () => {
    // A terminal task with NO command (a saved bare shell) is the "different
    // experience": even a clean exit (code 0) must NOT auto-close — it stays as a
    // stopped slot, unlike a command task whose success removes its pane.
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: null });
    store.startTask(id);
    store.noteExit(id, 0);
    expect(store.runtime[id]).toBeDefined();
    expect(store.runtime[id].running).toBe(false);
    expect(store.runtime[id].exitCode).toBe(0);
  });
});

describe('project-tasks — agent dispatch', () => {
  it('Agent task opens a workspace session', async () => {
    const store = new ProjectTasksStore();
    const spy = vi.fn();
    store.setAgentLauncher(spy);
    const id = await store.create('p', { kind: 'agent', prompt: 'do the thing' });
    store.startTask(id);
    expect(spy).toHaveBeenCalledTimes(1);
    const [def, projectId] = spy.mock.calls[0] as [TaskDef, string];
    expect(def.id).toBe(id);
    expect(def.kind).toBe('agent');
    expect(projectId).toBe('p');
  });

  it('Agent task does not use the right panel', async () => {
    const store = new ProjectTasksStore();
    store.setAgentLauncher(vi.fn());
    const id = await store.create('p', { kind: 'agent', prompt: 'do the thing' });
    store.startTask(id);
    expect(store.runtime[id]).toBeUndefined();
  });
});

describe('project-tasks — bare terminals', () => {
  it('Bare shell launch', () => {
    const store = new ProjectTasksStore();
    const before = JSON.stringify(store.byProject);
    const id = store.launchBareTerminal('p');
    const bare = store.bareForProject('p').find((b) => b.id === id);
    expect(bare).toBeDefined();
    expect(bare?.running).toBe(true);
    // No TaskDef was created.
    expect(JSON.stringify(store.byProject)).toBe(before);
  });

  it('Bare shell persists on exit', () => {
    const store = new ProjectTasksStore();
    const id = store.launchBareTerminal('p');
    store.noteBareExit(id, 0);
    const bare = store.bareForProject('p').find((b) => b.id === id);
    // Even on a clean exit the bare shell stays as a stopped slot (not removed).
    expect(bare).toBeDefined();
    expect(bare?.running).toBe(false);
    expect(bare?.exitCode).toBe(0);
  });
});

describe('project-tasks — migration', () => {
  it('migrates legacy terminals.json on first load', async () => {
    // No tasks.json yet, but a legacy terminals.json exists.
    let legacy = addTask({}, 'p', { id: 'a', name: 'zsh', command: null, cwd: null } as TaskDef);
    legacy = addTask(legacy, 'p', { id: 'b', name: 'npm run dev', command: 'npm run dev', cwd: null } as TaskDef);
    const legacyJson = serializeTasks(legacy);

    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'tasks_load') return null; // no tasks.json
      if (cmd === 'terminals_load') return legacyJson;
      return null;
    });

    const store = new ProjectTasksStore();
    await store.load();

    // Populated as terminal tasks.
    expect(store.forProject('p').map((t) => t.id)).toEqual(['a', 'b']);
    expect(store.forProject('p').every((t) => t.kind === 'terminal')).toBe(true);
    // The migration persisted the result.
    const saved = invokeMock.mock.calls.some((c) => c[0] === 'tasks_save');
    expect(saved).toBe(true);

    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => null);
  });

  it('present-but-empty tasks.json does not resurrect legacy terminals', async () => {
    // The user deliberately deleted all their tasks: tasks.json exists but is an
    // empty envelope. A stale (read-only) terminals.json must NOT bring them back.
    const legacy = addTask({}, 'p', {
      id: 'a',
      name: 'npm run dev',
      kind: 'terminal',
      command: 'npm run dev',
      cwd: null
    } as TaskDef);
    const legacyJson = serializeTasks(legacy);

    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'tasks_load') return serializeTasks({}); // present, empty (not null)
      if (cmd === 'terminals_load') return legacyJson;
      return null;
    });

    const store = new ProjectTasksStore();
    await store.load();

    // Stays empty — migration is keyed off "tasks.json absent", not "no tasks".
    expect(store.projectIds).toEqual([]);
    expect(store.forProject('p')).toEqual([]);

    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => null);
  });
});
