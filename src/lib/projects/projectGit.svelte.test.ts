import { describe, expect, it, vi, beforeEach } from 'vitest';

// `invoke` is mocked so the store's git_status_for fetch can be asserted without a
// live Tauri backend. Mock pattern mirrors projectGitActions / projectGitBusy tests.
const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { ProjectGitStore } from './projectGit.svelte';

beforeEach(() => {
  invokeMock.mockReset();
});

describe('ProjectGitStore.refreshOne', () => {
  it('updates only its own path and preserves other entries', async () => {
    const store = new ProjectGitStore();
    store.byPath = {
      '/a': { branch: 'main', dirty: false, modified: 0, ahead: 0, behind: 0 },
      '/b': { branch: 'dev', dirty: true, modified: 3, ahead: 1, behind: 0 }
    };
    // git_status_for([/a]) reports /a is now on a freshly switched branch.
    invokeMock.mockResolvedValueOnce({
      '/a': { branch: 'feature', dirty: false, modified: 0, ahead: 0, behind: 0 }
    });

    await store.refreshOne('/a');

    // Fetched for exactly the one path…
    expect(invokeMock).toHaveBeenCalledWith('git_status_for', { paths: ['/a'] });
    // …/a is updated to the new branch…
    expect(store.byPath['/a'].branch).toBe('feature');
    // …and /b is preserved untouched (NOT clobbered like a full refresh would).
    expect(store.byPath['/b']).toEqual({
      branch: 'dev',
      dirty: true,
      modified: 3,
      ahead: 1,
      behind: 0
    });
  });

  it('a null/empty path is a no-op and never invokes', async () => {
    const store = new ProjectGitStore();
    await store.refreshOne(null);
    await store.refreshOne('');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('a failed fetch leaves the map untouched', async () => {
    const store = new ProjectGitStore();
    store.byPath = { '/a': { branch: 'main', dirty: false, modified: 0, ahead: 0, behind: 0 } };
    invokeMock.mockRejectedValueOnce('not tauri');
    await store.refreshOne('/a');
    expect(store.byPath['/a'].branch).toBe('main');
  });
});

describe('ProjectGitStore.fetchRemotes', () => {
  it('invokes git_fetch_for with the given paths', async () => {
    const store = new ProjectGitStore();
    await store.fetchRemotes(['/a', '/b']);
    expect(invokeMock).toHaveBeenCalledWith('git_fetch_for', { paths: ['/a', '/b'] });
  });

  it('an empty path list is a no-op and never invokes', async () => {
    const store = new ProjectGitStore();
    await store.fetchRemotes([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('a failed fetch is swallowed (best-effort, never throws)', async () => {
    const store = new ProjectGitStore();
    invokeMock.mockRejectedValueOnce('not tauri');
    await expect(store.fetchRemotes(['/a'])).resolves.toBeUndefined();
  });
});
