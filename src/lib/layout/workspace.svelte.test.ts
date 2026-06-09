import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WorkspaceStore } from './workspace.svelte';
import { leavesInOrder } from './tree';

// `invoke` is mocked so the worktree-cleanup wiring (fired fire-and-forget on a
// PERMANENT session close) can be asserted without a live Tauri backend. Mock
// pattern mirrors the other tests that stub `@tauri-apps/api/core` (e.g.
// launcher/worktree, recents, projectTasks).
const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

// Store-level behavior for "Resume An Archived Session By Selecting It" (agent-overview
// spec). The `it(...)` titles are the EXACT `#### Scenario:` names so the
// scenario-coverage gate maps them here. Named `*.svelte.test.ts` so vitest compiles
// the `$state` runes. The live spawn / teleport / 60s re-archive timer are LIVE/MANUAL
// (a real PTY + focus loop); these assert the registry transitions the inbox drives.

/** A fresh store with one single-pane workspace; returns the store + that paneId. */
function withPane(program: string): { store: WorkspaceStore; paneId: string } {
  const store = new WorkspaceStore();
  const wsId = store.newWorkspace(program, '/proj');
  const entry = store.workspaces.find((w) => w.id === wsId)!;
  const paneId = leavesInOrder(entry.ws.root)[0].paneId;
  return { store, paneId };
}

describe('workspace — Resume An Archived Session By Selecting It', () => {
  it('Selecting an archived resumable session resumes it for preview', () => {
    const { store, paneId } = withPane('claude');
    const sessionId = store.session(paneId).sessionId;
    expect(sessionId).toBeTruthy(); // a claude pane is resumable

    // Archive it (its PTY terminates; it sits under Archived).
    store.closeAgent(paneId);
    expect(store.session(paneId).closed).toBe(true);

    // Selecting it for preview respawns `claude --resume <sessionId>` (closed:false,
    // resume:true) yet keeps it presented as Archived (preview:true) with the
    // unarchive baseline recorded.
    store.previewArchived(paneId, 1);
    const s = store.session(paneId);
    expect(s.closed).toBe(false);
    expect(s.resume).toBe(true);
    expect(s.preview).toBe(true);
    expect(s.previewCount).toBe(1);
    expect(s.sessionId).toBe(sessionId); // same transcript

    // Re-previewing (the auto-preview effect re-fires every focus tick) must NOT reset
    // an already-established baseline.
    store.previewArchived(paneId, 5);
    expect(store.session(paneId).previewCount).toBe(1);

    // Committing the preview (the unarchive) drops preview state, leaving it live.
    store.commitPreview(paneId);
    const after = store.session(paneId);
    expect(after.preview).toBeUndefined();
    expect(after.previewCount).toBeUndefined();
    expect(after.closed).toBe(false);

    // Re-archiving a previewing session always clears its preview state too.
    store.previewArchived(paneId, 2);
    store.closeAgent(paneId);
    const rearchived = store.session(paneId);
    expect(rearchived.closed).toBe(true);
    expect(rearchived.resume).toBe(false);
    expect(rearchived.preview).toBeUndefined();
    expect(rearchived.previewCount).toBeUndefined();
  });

  it('A non-resumable archived session is just selected', () => {
    const { store, paneId } = withPane('/bin/zsh'); // shell pane: no session id
    expect(store.session(paneId).sessionId).toBeFalsy();

    store.closeAgent(paneId);
    // previewArchived is a no-op for a non-resumable pane — the inbox just selects it.
    store.previewArchived(paneId, 0);
    const s = store.session(paneId);
    expect(s.preview).toBeUndefined();
    expect(s.resume).toBeFalsy();
    expect(s.closed).toBe(true); // stays archived
  });

  it('lazily establishes the preview/pause baseline only while unset', () => {
    const { store, paneId } = withPane('claude');

    // Preview with an UNKNOWN baseline (transcript not yet polled): previewCount null.
    store.closeAgent(paneId);
    store.previewArchived(paneId, null);
    expect(store.session(paneId).previewCount).toBeNull();

    // The gate effect establishes it from the first known reading — once.
    store.establishPreviewBaseline(paneId, 4);
    expect(store.session(paneId).previewCount).toBe(4);
    // A later reading must NOT move an already-established baseline.
    store.establishPreviewBaseline(paneId, 9);
    expect(store.session(paneId).previewCount).toBe(4);

    // Same one-shot semantics for a paused agent's baseline.
    const { store: s2, paneId: p2 } = withPane('claude');
    s2.pauseAgent(p2, null);
    expect(s2.session(p2).pausedCount).toBeNull();
    s2.establishPausedBaseline(p2, 2);
    expect(s2.session(p2).pausedCount).toBe(2);
    s2.establishPausedBaseline(p2, 7);
    expect(s2.session(p2).pausedCount).toBe(2);
  });
});

describe('workspace — worktree cleanup on permanent close', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  /** A store with one single-pane workspace launched into a worktree; returns the
   *  store, the paneId, and the worktree fields recorded on its registry entry. */
  function withWorktreePane(): {
    store: WorkspaceStore;
    paneId: string;
    worktreePath: string;
    worktreeBase: string;
  } {
    const worktreePath = '/repo/.worktrees/session-x';
    const worktreeBase = 'abc123';
    const store = new WorkspaceStore();
    const wsId = store.newWorkspace(
      'claude',
      worktreePath,
      undefined,
      'proj-1',
      worktreePath,
      worktreeBase
    );
    const entry = store.workspaces.find((w) => w.id === wsId)!;
    const paneId = leavesInOrder(entry.ws.root)[0].paneId;
    return { store, paneId, worktreePath, worktreeBase };
  }

  it('closeFocused on a worktree-backed pane removes its worktree if clean', () => {
    const { store, worktreePath, worktreeBase } = withWorktreePane();
    // Split so there are two leaves — closing the focused one actually prunes it
    // (closing the ONLY leaf is a no-op and must NOT fire cleanup).
    store.split('row');
    // Refocus the worktree-backed (first) leaf, then close it.
    const entry = store.active!;
    const worktreeLeaf = leavesInOrder(entry.ws.root).find(
      (l) => entry.registry[l.paneId]?.worktreePath === worktreePath
    )!;
    store.setFocus(worktreeLeaf.id);

    store.closeFocused();

    expect(invokeMock).toHaveBeenCalledWith('worktree_remove_if_clean', {
      worktreePath,
      base: worktreeBase
    });
  });

  it('closeFocused on a pane with no worktree does not invoke cleanup', () => {
    const store = new WorkspaceStore();
    store.newWorkspace('/bin/zsh', '/proj'); // no worktree fields
    // Split so the focused close actually prunes a leaf.
    store.split('row');

    store.closeFocused();

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('closeFocused on the only leaf is a no-op and does not invoke cleanup', () => {
    const { store } = withWorktreePane();
    // Single leaf: closeLeaf is a no-op, the pane survives, so no cleanup fires.
    store.closeFocused();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('closeWorkspace removes the worktree of each closing worktree-backed pane', () => {
    const { store, worktreePath, worktreeBase } = withWorktreePane();
    const wsId = store.active!.id;

    store.closeWorkspace(wsId);

    expect(invokeMock).toHaveBeenCalledWith('worktree_remove_if_clean', {
      worktreePath,
      base: worktreeBase
    });
  });

  it('closeWorkspace cleans up every worktree-backed pane it prunes', () => {
    const store = new WorkspaceStore();
    // Pane 1: worktree-backed.
    const wsId = store.newWorkspace(
      'claude',
      '/repo/.worktrees/a',
      undefined,
      'proj-1',
      '/repo/.worktrees/a',
      'baseA'
    );
    // Pane 2 (split into the same workspace): a second worktree-backed pane.
    store.splitWith(
      'row',
      'claude',
      '/repo/.worktrees/b',
      undefined,
      'after',
      'proj-1',
      '/repo/.worktrees/b',
      'baseB'
    );
    // Pane 3 (split again): no worktree.
    store.split('row');

    store.closeWorkspace(wsId);

    expect(invokeMock).toHaveBeenCalledWith('worktree_remove_if_clean', {
      worktreePath: '/repo/.worktrees/a',
      base: 'baseA'
    });
    expect(invokeMock).toHaveBeenCalledWith('worktree_remove_if_clean', {
      worktreePath: '/repo/.worktrees/b',
      base: 'baseB'
    });
    // Only the two worktree-backed panes trigger cleanup (the plain shell does not).
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('deleteAgent on a multi-pane workspace removes the deleted pane worktree', () => {
    const store = new WorkspaceStore();
    // Worktree-backed pane plus a second (plain) pane in the same workspace, so
    // deleteAgent takes its multi-pane branch (prune the leaf) rather than
    // delegating to closeWorkspace.
    store.newWorkspace('claude', '/repo/.worktrees/a', undefined, 'proj-1', '/repo/.worktrees/a', 'baseA');
    store.split('row'); // second, worktree-less leaf
    const entry = store.active!;
    const wtLeaf = leavesInOrder(entry.ws.root).find(
      (l) => entry.registry[l.paneId]?.worktreePath === '/repo/.worktrees/a'
    )!;

    store.deleteAgent(wtLeaf.paneId);

    expect(invokeMock).toHaveBeenCalledWith('worktree_remove_if_clean', {
      worktreePath: '/repo/.worktrees/a',
      base: 'baseA'
    });
  });

  it('Archiving does not remove the worktree', () => {
    const { store, paneId } = withWorktreePane();

    store.closeAgent(paneId);

    expect(store.session(paneId).closed).toBe(true); // archived, still resumable
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
