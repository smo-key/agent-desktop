import { describe, expect, it, vi, beforeEach } from 'vitest';

// `invoke` is mocked so the store's projects_load/projects_save round-trips can be
// asserted without a live Tauri backend. Mock pattern mirrors the projectGit tests.
const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { ProjectsStore } from './projects.svelte';
import type { Project } from './projects';

function p(over: Partial<Project> = {}): Project {
  return { id: 'a', name: 'A', path: '/a', icon: 'box', color: '#4C8DFF', ...over };
}

/** The `projects` payload of the Nth `projects_save` call. */
function savedList(n: number): Project[] {
  const calls = invokeMock.mock.calls.filter((c) => c[0] === 'projects_save');
  const arg = calls[n][1] as { json: string };
  return JSON.parse(arg.json).projects as Project[];
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
});

describe('ProjectsStore — archive / unarchive', () => {
  it('archives in place, exposes active/archived views, and persists each step', async () => {
    const store = new ProjectsStore();
    store.list = [p({ id: 'a', path: '/a' }), p({ id: 'b', path: '/b' })];

    await store.archive('a');
    expect(store.list.map((x) => [x.id, x.archived === true])).toEqual([['a', true], ['b', false]]);
    expect(store.active.map((x) => x.id)).toEqual(['b']);
    expect(store.archived.map((x) => x.id)).toEqual(['a']);
    expect(savedList(0)[0]).toMatchObject({ id: 'a', archived: true });

    await store.unarchive('a');
    expect(store.active.map((x) => x.id)).toEqual(['a', 'b']);
    expect('archived' in savedList(1)[0]).toBe(false);
  });

  it('is a no-op (no save) when the flag is already in the requested state or the id is unknown', async () => {
    const store = new ProjectsStore();
    store.list = [p({ id: 'a', archived: true })];
    await store.archive('a');
    await store.unarchive('missing');
    expect(invokeMock).not.toHaveBeenCalledWith('projects_save', expect.anything());
  });

  it('chains saves so a rapid archive then unarchive persists the final state in order', async () => {
    const store = new ProjectsStore();
    store.list = [p({ id: 'a' })];
    // The FIRST save is slow; the second would otherwise overtake it and the
    // slow, stale write would land last.
    const order: string[] = [];
    let releaseFirst!: () => void;
    invokeMock.mockImplementation(async (cmd: unknown, args: unknown) => {
      if (cmd !== 'projects_save') return null;
      const json = (args as { json: string }).json;
      const archived = (JSON.parse(json).projects as Project[])[0].archived === true;
      if (order.length === 0) {
        await new Promise<void>((r) => (releaseFirst = r));
      }
      order.push(archived ? 'archived' : 'active');
      return null;
    });

    const first = store.archive('a');
    const second = store.unarchive('a');
    await Promise.resolve(); // let both mutations enqueue their saves
    expect(store.list[0].archived).toBeUndefined(); // in-memory: final state already
    // The second save has NOT overtaken the still-blocked first one.
    expect(order).toEqual([]);
    releaseFirst();
    await Promise.all([first, second]);

    // Both writes ran in order, each serializing the list as it stood at its turn,
    // so the LAST write on disk is the live (unarchived) state.
    expect(order).toHaveLength(2);
    expect(order[order.length - 1]).toBe('active');
  });
});
