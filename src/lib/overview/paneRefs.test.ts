import { describe, expect, it } from 'vitest';
import { allAgentPaneRefs, isLivePane, liveAgentPaneRefs } from './paneRefs';
import type { WorkspaceEntry } from '$lib/layout/workspace.svelte';

function entry(registry: WorkspaceEntry['registry']): WorkspaceEntry {
  return { id: 'w', name: 'W', ws: { root: { type: 'leaf', id: 'n', paneId: 'x' } } as never, registry };
}

const workspaces: WorkspaceEntry[] = [
  entry({
    live: { program: 'claude', cwd: '/a', sessionId: 's-live' },
    closed: { program: 'claude', cwd: '/b', sessionId: 's-closed', closed: true },
    shell: { program: '/bin/zsh', cwd: '/c' },
    nosid: { program: 'claude', cwd: '/d' },
    wt: { program: 'copilot', cwd: '/e', worktreeCwd: '/e/.wt', sessionId: 's-wt' }
  })
];

describe('paneRefs (performance: closed panes leave the polling sets)', () => {
  it('isLivePane: closed or missing sessions are not live', () => {
    expect(isLivePane({ closed: false })).toBe(true);
    expect(isLivePane({})).toBe(true);
    expect(isLivePane({ closed: true })).toBe(false);
    expect(isLivePane(null)).toBe(false);
  });

  it('Closed agents leave the polling sets', () => {
    const ids = liveAgentPaneRefs(workspaces).map((r) => r.paneId);
    expect(ids).toEqual(['live', 'wt']);
  });

  it('allAgentPaneRefs keeps closed panes (for one-shot in-memory seeding)', () => {
    const ids = allAgentPaneRefs(workspaces).map((r) => r.paneId);
    expect(ids).toEqual(['live', 'closed', 'wt']);
  });

  it('refs carry the worktree cwd when adopted, and the program', () => {
    const wt = liveAgentPaneRefs(workspaces).find((r) => r.paneId === 'wt');
    expect(wt).toEqual({ paneId: 'wt', sessionId: 's-wt', cwd: '/e/.wt', program: 'copilot' });
  });
});
