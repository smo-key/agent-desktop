import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createWorktree } from './worktree';

// `invoke` is mocked — these assert the wrapper's resolve→object / reject→null
// contract without a live Tauri backend. (Mock pattern mirrors the other tests
// that stub `@tauri-apps/api/core`, e.g. recents/projectTasks.)
const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

describe('createWorktree', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('returns the worktree object when invoke resolves', async () => {
    const created = { path: '/repo/.worktrees/session-x', branch: 'session/x', base: 'abc123' };
    invokeMock.mockImplementationOnce(async () => created);

    const result = await createWorktree('/repo');

    expect(result).toEqual(created);
    expect(invokeMock).toHaveBeenCalledWith('worktree_create', { repoPath: '/repo' });
  });

  it('returns null when invoke rejects (never throws)', async () => {
    invokeMock.mockImplementationOnce(async () => {
      throw new Error('not a git repo');
    });

    const result = await createWorktree('/repo');

    expect(result).toBeNull();
  });
});
