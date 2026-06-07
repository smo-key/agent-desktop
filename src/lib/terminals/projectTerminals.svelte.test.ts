import { describe, expect, it, vi } from 'vitest';

// ProjectTerminalsStore tests. Named `*.svelte.test.ts` so vitest compiles the
// store's `$state` runes. Titles match the project-terminals + terminals-panel
// `#### Scenario:` names for the runtime-lifecycle + running-indicator behaviors
// (the pure model is covered separately in projectTerminals.test.ts). The Tauri
// `invoke` is mocked — these assert the store's in-memory lifecycle, not I/O.

const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { ProjectTerminalsStore } from './projectTerminals.svelte';
import { serializeTerminals, captureRunningState, addTerminal } from './projectTerminals';

describe('project-terminals — runtime lifecycle', () => {
  it('Start a stopped terminal', async () => {
    const store = new ProjectTerminalsStore();
    const id = await store.create('p', { command: 'npm run dev' });
    store.stop(id);
    expect(store.isRunning(id)).toBe(false);
    store.start(id);
    expect(store.isRunning(id)).toBe(true);
  });

  it('Stop a running terminal', async () => {
    const store = new ProjectTerminalsStore();
    const id = await store.create('p', { command: 'npm run dev' });
    expect(store.isRunning(id)).toBe(true);
    store.stop(id);
    expect(store.isRunning(id)).toBe(false);
    // The slot remains in the collection (stopping does not remove it).
    expect(store.forProject('p').some((t) => t.id === id)).toBe(true);
  });

  it('Restart a terminal', async () => {
    const store = new ProjectTerminalsStore();
    const id = await store.create('p', { command: 'npm run dev' });
    const firstPane = store.runtime[id].paneId;
    store.restart(id);
    expect(store.isRunning(id)).toBe(true);
    // A fresh pane id forces the `{#key}` to remount → a new PTY spawns.
    expect(store.runtime[id].paneId).not.toBe(firstPane);
  });

  it('Process exiting on its own marks the terminal stopped', async () => {
    const store = new ProjectTerminalsStore();
    const id = await store.create('p', { command: 'npm run dev' });
    store.noteExit(id, 137);
    expect(store.isRunning(id)).toBe(false);
    expect(store.runtime[id].exitCode).toBe(137);
    // Not removed: the slot stays so the user can restart it.
    expect(store.forProject('p').some((t) => t.id === id)).toBe(true);
  });

  it('remove drops the slot and stops its process', async () => {
    const store = new ProjectTerminalsStore();
    const id = await store.create('p', { command: 'x' });
    await store.remove(id);
    expect(store.forProject('p')).toEqual([]);
    expect(store.runtime[id]).toBeUndefined();
  });
});

describe('project-terminals — restore with running command', () => {
  it('Restored terminal re-runs its last running command', async () => {
    // Build a persisted state where terminal 'a' was running `npm run dev` at quit.
    let map = addTerminal({}, 'p', {
      id: 'a',
      name: 'zsh',
      command: null,
      cwd: null
    });
    map = captureRunningState(map, { a: { running: true, title: 'npm run dev' } });
    const json = serializeTerminals(map);
    invokeMock.mockImplementationOnce(async () => json); // terminals_load returns it

    const store = new ProjectTerminalsStore();
    await store.load();

    // It auto-restarted (running) and queued the command as initial input.
    expect(store.isRunning('a')).toBe(true);
    expect(store.runtime['a'].initialInput).toBe('npm run dev');
  });

  it('restores a plain shell when nothing was running', async () => {
    let map = addTerminal({}, 'p', { id: 'a', name: 'zsh', command: null, cwd: null });
    map = captureRunningState(map, { a: { running: false } });
    invokeMock.mockImplementationOnce(async () => serializeTerminals(map));

    const store = new ProjectTerminalsStore();
    await store.load();
    // Not running, nothing queued.
    expect(store.isRunning('a')).toBe(false);
  });
});

describe('terminals-panel — running indicator', () => {
  it('Indicator reflects running processes while hidden', async () => {
    const store = new ProjectTerminalsStore();
    await store.create('p', { command: 'a' });
    await store.create('p', { command: 'b' });
    // The count is panel-visibility independent (it is pure store state).
    expect(store.runningCount).toBe(2);
  });

  it('Indicator clears when nothing runs', async () => {
    const store = new ProjectTerminalsStore();
    const id = await store.create('p', { command: 'a' });
    store.stop(id);
    expect(store.runningCount).toBe(0);
  });

  it('counts running terminals across projects', async () => {
    const store = new ProjectTerminalsStore();
    await store.create('web', { command: 'a' });
    await store.create('api', { command: 'b' });
    expect(store.runningCount).toBe(2);
  });
});

describe('project-terminals — terminal title', () => {
  it('Terminal title reflects the running command', async () => {
    const store = new ProjectTerminalsStore();
    const id = await store.create('p'); // empty shell
    const def = store.forProject('p')[0];
    // Before any title escape, the name falls back to the shell basename.
    expect(store.displayName(def)).toBe(store.shell.split('/').pop());
    // An OSC title (the running command) overrides the display name.
    store.noteTitle(id, 'vim README.md');
    expect(store.displayName(def)).toBe('vim README.md');
  });

  it('ignores empty titles and keeps the last non-empty one', async () => {
    const store = new ProjectTerminalsStore();
    const id = await store.create('p');
    store.noteTitle(id, 'npm run dev');
    store.noteTitle(id, '   ');
    expect(store.displayName(store.forProject('p')[0])).toBe('npm run dev');
  });

  it('A created shell terminal is named after the shell', async () => {
    const store = new ProjectTerminalsStore();
    await store.create('p');
    expect(store.forProject('p')[0].name).toBe(store.shell.split('/').pop());
  });

  it('Falls back to the shell name with no reported title', async () => {
    const store = new ProjectTerminalsStore();
    await store.create('p');
    // No noteTitle() called → displayName is the shell basename.
    expect(store.displayName(store.forProject('p')[0])).toBe(store.shell.split('/').pop());
  });
});
