import { describe, expect, it, vi } from 'vitest';

// ProjectTasksStore tests. Named `*.svelte.test.ts` so vitest compiles the
// store's `$state` runes. Titles match the project-terminals + terminals-panel
// `#### Scenario:` names for the runtime-lifecycle + running-indicator behaviors
// (the pure model is covered separately in projectTasks.test.ts). The Tauri
// `invoke` is mocked — these assert the store's in-memory lifecycle, not I/O.

const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { ProjectTasksStore } from './projectTasks.svelte';
import { serializeProjectTasks, parseProjectTasks, type TaskDef } from './projectTasks';

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

describe('project-terminals — restore on launch', () => {
  it('No auto-restart after relaunch', async () => {
    // A persisted terminal restores as a STOPPED slot — auto-restart was dropped
    // (add-project-folder-storage): nothing is auto-started on load.
    const json = serializeProjectTasks([
      { id: 'a', name: 'zsh', kind: 'terminal', command: null, cwd: null }
    ]);
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'project_tasks_load') return json;
      return null; // tasks_load/terminals_load => null ⇒ migration no-op
    });

    const store = new ProjectTasksStore();
    store.setProjectsAccessor(() => [{ id: 'p', path: '/p' }]);
    await store.load();

    // The def is restored but NOT running.
    expect(store.forProject('p').map((t) => t.id)).toEqual(['a']);
    expect(store.isRunning('a')).toBe(false);

    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => null);
  });

  it('restores a plain shell when nothing was running', async () => {
    const json = serializeProjectTasks([
      { id: 'a', name: 'zsh', kind: 'terminal', command: null, cwd: null }
    ]);
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'project_tasks_load') return json;
      return null;
    });

    const store = new ProjectTasksStore();
    store.setProjectsAccessor(() => [{ id: 'p', path: '/p' }]);
    await store.load();
    // Restored as a stopped slot; nothing running.
    expect(store.isRunning('a')).toBe(false);

    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => null);
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
    store.setProjectsAccessor(() => [{ id: 'p', path: '/p' }]);
    invokeMock.mockClear();
    const t1 = await store.create('p', { kind: 'terminal', command: 'npm run dev' });
    const t2 = await store.create('p', { kind: 'agent', prompt: 'fix the bug' });

    // The last per-project save carries a sanitized flat envelope that re-parses to
    // the exact current defs for project `p`.
    const saveCalls = invokeMock.mock.calls.filter((c) => c[0] === 'project_tasks_save');
    expect(saveCalls.length).toBeGreaterThan(0);
    const lastSave = saveCalls[saveCalls.length - 1];
    expect((lastSave[1] as { projectPath: string }).projectPath).toBe('/p');
    const json = (lastSave[1] as { json: string }).json;
    const reparsed = parseProjectTasks(json);
    expect(reparsed).toEqual([store.defForId(t1), store.defForId(t2)]);
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

  it('Successful task announces completion', async () => {
    const store = new ProjectTasksStore();
    const completed: string[] = [];
    store.setTaskCompleteHandler((name) => completed.push(name));
    const id = await store.create('p', { kind: 'terminal', command: 'npm test', name: 'Run tests' });
    store.startTask(id);
    store.noteExit(id, 0);
    // The completion handler fired with the task's name (the app shows a toast).
    expect(completed).toEqual(['Run tests']);
  });

  it('does not announce completion on a failed exit', async () => {
    const store = new ProjectTasksStore();
    const completed: string[] = [];
    store.setTaskCompleteHandler((name) => completed.push(name));
    const id = await store.create('p', { kind: 'terminal', command: 'npm test', name: 'Run tests' });
    store.startTask(id);
    store.noteExit(id, 1);
    expect(completed).toEqual([]);
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

  it('No-command terminal exit zero closes', async () => {
    // A clean exit (code 0) closes ANY terminal — including a no-command shell task
    // — by removing its runtime pane. The def stays as an idle task.
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: null });
    store.startTask(id);
    store.noteExit(id, 0);
    expect(store.runtime[id]).toBeUndefined();
    expect(store.forProject('p').some((t) => t.id === id)).toBe(true);
  });
});

describe('project-terminals — close-on-complete', () => {
  it('defaults a terminal to close-on-complete (no stored flag)', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm test' });
    // Default is the ABSENCE of the flag — the def carries no closeOnComplete.
    expect(store.defForId(id)?.closeOnComplete).toBeUndefined();
  });

  it('stores closeOnComplete:false when the box is unticked', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', {
      kind: 'terminal',
      command: 'npm test',
      closeOnComplete: false
    });
    expect(store.defForId(id)?.closeOnComplete).toBe(false);
  });

  it('Keep open on success when opted out', async () => {
    const store = new ProjectTasksStore();
    const completed: string[] = [];
    store.setTaskCompleteHandler((name) => completed.push(name));
    const id = await store.create('p', {
      kind: 'terminal',
      command: 'npm test',
      name: 'Run tests',
      closeOnComplete: false
    });
    store.startTask(id);
    store.noteExit(id, 0);
    // The pane STAYS as a stopped, non-failed slot (so its output remains readable)…
    expect(store.runtime[id]).toBeDefined();
    expect(store.runtime[id].running).toBe(false);
    expect(store.runtime[id].exitCode).toBe(0);
    expect(store.isFailed(id)).toBe(false);
    // …and completion is still announced (the app shows a toast either way).
    expect(completed).toEqual(['Run tests']);
  });

  it('still auto-closes a successful pane when closeOnComplete is the default', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm test' });
    store.startTask(id);
    store.noteExit(id, 0);
    expect(store.runtime[id]).toBeUndefined();
  });

  it('keeps a FAILED keep-open pane open and flagged failed', async () => {
    // closeOnComplete only governs the SUCCESS path; a non-zero exit always stays.
    const store = new ProjectTasksStore();
    const id = await store.create('p', {
      kind: 'terminal',
      command: 'npm test',
      closeOnComplete: false
    });
    store.startTask(id);
    store.noteExit(id, 2);
    expect(store.runtime[id]).toBeDefined();
    expect(store.isFailed(id)).toBe(true);
  });

  it('toggles closeOnComplete via update (false sets, true clears)', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm test' });
    await store.update(id, { kind: 'terminal', closeOnComplete: false });
    expect(store.defForId(id)?.closeOnComplete).toBe(false);
    await store.update(id, { kind: 'terminal', closeOnComplete: true });
    // Back to default ⇒ the flag is cleared, not stored as true.
    expect(store.defForId(id)?.closeOnComplete).toBeUndefined();
  });
});

describe('project-folder-storage — save resilience', () => {
  it('Write failure keeps in-memory state', async () => {
    // When project_tasks_save rejects, the in-memory byProject is preserved and
    // no error escapes the store (the failure is swallowed + marked dirty).
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'project_tasks_save') throw new Error('unwritable folder');
      return null;
    });
    const store = new ProjectTasksStore();
    store.setProjectsAccessor(() => [{ id: 'p', path: '/p' }]);

    // create() awaits saveProject() internally; it must NOT throw despite the reject.
    const id = await store.create('p', { kind: 'terminal', command: 'npm run dev' });

    // The def survives in memory even though the write failed.
    expect(store.forProject('p').map((t) => t.id)).toEqual([id]);

    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => null);
  });

  it('Retry on next save', async () => {
    // A project left dirty by a failed save is re-flushed on the next successful
    // saveProject — project_tasks_save is invoked for it again.
    let failNext = true;
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: unknown, args: unknown) => {
      if (cmd === 'project_tasks_save') {
        const path = (args as { projectPath?: string })?.projectPath;
        if (failNext && path === '/p') throw new Error('unwritable folder');
      }
      return null;
    });
    const store = new ProjectTasksStore();
    store.setProjectsAccessor(() => [{ id: 'p', path: '/p' }]);

    // First save fails ⇒ project 'p' is now dirty.
    await store.create('p', { kind: 'terminal', command: 'a' });

    // Now allow writes to succeed; a later save flushes the dirty project again.
    failNext = false;
    invokeMock.mockClear();
    await store.create('p', { kind: 'terminal', command: 'b' });

    const pSaves = invokeMock.mock.calls.filter(
      (c) => c[0] === 'project_tasks_save' && (c[1] as { projectPath?: string })?.projectPath === '/p'
    );
    expect(pSaves.length).toBeGreaterThan(0);

    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => null);
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

  it('Bare shell closes on success', () => {
    const store = new ProjectTasksStore();
    const id = store.launchBareTerminal('p');
    store.noteBareExit(id, 0);
    // A clean exit closes the bare terminal — its slot is removed.
    expect(store.bareForProject('p').find((b) => b.id === id)).toBeUndefined();
  });

  it('Bare shell stays open on error', () => {
    const store = new ProjectTasksStore();
    const id = store.launchBareTerminal('p');
    store.noteBareExit(id, 1);
    const bare = store.bareForProject('p').find((b) => b.id === id);
    // A non-zero exit stays as a stopped slot so the error is readable.
    expect(bare).toBeDefined();
    expect(bare?.running).toBe(false);
    expect(bare?.exitCode).toBe(1);
  });

  it('Bare shell runs an initial command', () => {
    const store = new ProjectTasksStore();
    // A bare terminal launched with a command carries it as initialInput so the
    // pane types+runs it once after spawn (e.g. a failed `git push`).
    const id = store.launchBareTerminal('p', 'git push');
    const bare = store.bareForProject('p').find((b) => b.id === id);
    expect(bare?.initialInput).toBe('git push');
    expect(bare?.running).toBe(true);
    // A blank/whitespace command leaves a plain interactive shell (no input).
    const id2 = store.launchBareTerminal('p', '   ');
    const bare2 = store.bareForProject('p').find((b) => b.id === id2);
    expect(bare2?.initialInput).toBeUndefined();
  });
});

describe('project-tasks — editing', () => {
  it('Edit a task definition', async () => {
    const store = new ProjectTasksStore();
    store.setProjectsAccessor(() => [{ id: 'p', path: '/p' }]);
    const id = await store.create('p', { kind: 'terminal', command: 'npm test', name: 'Test' });
    await store.update(id, { name: 'Run tests', command: 'npm run test:ci' });
    const def = store.forProject('p').find((t) => t.id === id)!;
    expect(def.name).toBe('Run tests');
    expect(def.command).toBe('npm run test:ci');
    // The edit was persisted (a per-project save carrying the new command).
    const saved = invokeMock.mock.calls.some(
      (c) =>
        c[0] === 'project_tasks_save' &&
        String((c[1] as { json?: string })?.json ?? '').includes('npm run test:ci')
    );
    expect(saved).toBe(true);
  });

  it('switches a task from terminal to agent on edit', async () => {
    const store = new ProjectTasksStore();
    const id = await store.create('p', { kind: 'terminal', command: 'npm test' });
    await store.update(id, { kind: 'agent', prompt: 'fix the failing test' });
    const def = store.forProject('p').find((t) => t.id === id)!;
    expect(def.kind).toBe('agent');
    expect(def.prompt).toBe('fix the failing test');
    expect(def.command).toBeNull();
  });
});
