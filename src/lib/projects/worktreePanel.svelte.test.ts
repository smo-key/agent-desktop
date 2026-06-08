import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WorktreePanel } from './worktreePanel.svelte';

// `invoke` is mocked so the worktree list/remove wiring can be asserted without a
// live Tauri backend. Mock pattern mirrors the other tests that stub
// `@tauri-apps/api/core` (e.g. launcher/worktree, recents, projectTasks).
const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

// The workspace singleton is mocked so `open()` can assert the launch plan WITHOUT
// spawning a PTY. We capture the plan passed to `launch`.
const launchMock = vi.fn((..._a: unknown[]) => {});
vi.mock('../layout/workspace.svelte', () => ({
  workspace: { launch: (...a: unknown[]) => launchMock(...a) }
}));

describe('WorktreePanel.load', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    launchMock.mockReset();
  });

  it('maps worktree_list results into the worktrees state', async () => {
    const listed = [
      { path: '/repo/.worktrees/a', branch: 'session/a', clean: true },
      { path: '/repo/.worktrees/b', branch: null, clean: false }
    ];
    invokeMock.mockImplementationOnce(async () => listed);

    const panel = new WorktreePanel('proj-1');
    await panel.load('/repo');

    expect(invokeMock).toHaveBeenCalledWith('worktree_list', { repoPath: '/repo' });
    expect(panel.worktrees).toEqual(listed);
  });

  it('leaves an empty list when the repo has no worktrees', async () => {
    invokeMock.mockImplementationOnce(async () => []);

    const panel = new WorktreePanel('proj-1');
    await panel.load('/repo');

    expect(panel.worktrees).toEqual([]);
  });
});

describe('WorktreePanel.prune', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    launchMock.mockReset();
  });

  it('prunes a CLEAN worktree directly without confirmation', async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    // First call resolves the remove; the refresh re-lists (empty).
    invokeMock.mockImplementation(async (cmd: unknown) =>
      cmd === 'worktree_list' ? [] : undefined
    );

    const panel = new WorktreePanel('proj-1');
    const wt = { path: '/repo/.worktrees/a', branch: 'session/a', clean: true };
    await panel.prune(wt);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith('worktree_remove', {
      worktreePath: '/repo/.worktrees/a',
      force: false
    });
    vi.unstubAllGlobals();
  });

  it('does NOT force-remove a DIRTY worktree when the user cancels confirmation', async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);

    const panel = new WorktreePanel('proj-1');
    const wt = { path: '/repo/.worktrees/b', branch: null, clean: false };
    await panel.prune(wt);

    expect(confirmSpy).toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith(
      'worktree_remove',
      expect.anything()
    );
    vi.unstubAllGlobals();
  });

  it('force-removes a DIRTY worktree when the user confirms', async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    invokeMock.mockImplementation(async (cmd: unknown) =>
      cmd === 'worktree_list' ? [] : undefined
    );

    const panel = new WorktreePanel('proj-1');
    const wt = { path: '/repo/.worktrees/b', branch: null, clean: false };
    await panel.prune(wt);

    expect(confirmSpy).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith('worktree_remove', {
      worktreePath: '/repo/.worktrees/b',
      force: true
    });
    vi.unstubAllGlobals();
  });

  it('refreshes the worktree list after a successful prune', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const remaining = [{ path: '/repo/.worktrees/keep', branch: 'session/keep', clean: true }];
    invokeMock.mockImplementation(async (cmd: unknown) =>
      cmd === 'worktree_list' ? remaining : undefined
    );

    const panel = new WorktreePanel('proj-1');
    panel.repoPath = '/repo';
    await panel.prune({ path: '/repo/.worktrees/a', branch: 'session/a', clean: true });

    expect(panel.worktrees).toEqual(remaining);
    vi.unstubAllGlobals();
  });
});

describe('WorktreePanel.open', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    launchMock.mockReset();
  });

  it('Opening a session into an existing worktree', () => {
    const panel = new WorktreePanel('proj-7');
    const wt = { path: '/repo/.worktrees/a', branch: 'session/a', clean: true };

    panel.open(wt);

    expect(launchMock).toHaveBeenCalledTimes(1);
    const plan = launchMock.mock.calls[0][0] as Record<string, unknown>;
    expect(plan.cwd).toBe('/repo/.worktrees/a');
    expect(plan.projectId).toBe('proj-7');
    expect(plan.placement).toBe('tab');
    // CRITICAL: opening an existing worktree must NOT mark it for auto-removal.
    expect(plan.worktreeBase).toBeUndefined();
  });
});
