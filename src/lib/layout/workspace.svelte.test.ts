import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WorkspaceStore } from './workspace.svelte';
import { leavesInOrder } from './tree';
import { findCoordinatorPane, type CoordinatorPaneView } from '../orchestration/coordinator';

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

// The COORDINATOR follows the SAME archive/delete rules as ordinary sessions
// (coordinator-lifecycle: "The coordinator can be archived or deleted"). A NON-empty
// coordinator archives (closed, retained, restorable); an EMPTY one deletes outright;
// restoring an archived coordinator resumes it as the project's LIVE coordinator, so
// `findCoordinatorPane` finds it again and the "Start coordinator" affordance hides.
describe('workspace — coordinator archive / delete / restore (coordinator-lifecycle)', () => {
  /** A fresh store with one single-pane COORDINATOR workspace for `projectId`. */
  function withCoordinator(projectId = 'proj-A'): {
    store: WorkspaceStore;
    paneId: string;
  } {
    const store = new WorkspaceStore();
    // makeEntry via newWorkspace(program, cwd, initialInput, projectId, …, role).
    const wsId = store.newWorkspace(
      'claude',
      '/proj',
      undefined,
      projectId,
      undefined,
      undefined,
      undefined,
      undefined,
      'coordinator'
    );
    const entry = store.workspaces.find((w) => w.id === wsId)!;
    const paneId = leavesInOrder(entry.ws.root)[0].paneId;
    return { store, paneId };
  }

  /** The framework-free coordinator view of every pane in the store (mirrors the
   *  Inbox's `allCoordinatorPanes` projection) so `findCoordinatorPane` can run. */
  function coordinatorPanes(store: WorkspaceStore): CoordinatorPaneView[] {
    const out: CoordinatorPaneView[] = [];
    for (const entry of store.workspaces) {
      for (const leaf of leavesInOrder(entry.ws.root)) {
        const s = entry.registry[leaf.paneId];
        if (!s) continue;
        out.push({
          paneId: leaf.paneId,
          program: s.program,
          projectId: s.projectId ?? null,
          role: s.role,
          closed: s.closed
        });
      }
    }
    return out;
  }

  it('archiving a NON-empty coordinator closes it (retained, restorable)', () => {
    const { store, paneId } = withCoordinator();
    // A non-empty session archives via closeAgent (the inbox routes a non-empty
    // userHash through archiveDecision → 'archive' → closeAgent).
    store.closeAgent(paneId);
    const s = store.session(paneId);
    expect(s.closed).toBe(true); // archived, not deleted
    expect(s.role).toBe('coordinator'); // still a coordinator entry, retained
    expect(s.sessionId).toBeTruthy(); // resumable transcript kept
    // Still present in the registry → restorable.
    expect(store.allPaneIds().has(paneId)).toBe(true);
  });

  it('archiving an EMPTY coordinator deletes it outright', () => {
    const { store, paneId } = withCoordinator();
    // An empty session (falsy userHash) deletes via deleteAgent (archiveDecision →
    // 'delete'). The coordinator follows the same empty-session rule.
    store.deleteAgent(paneId);
    // Gone from the registry across all workspaces.
    expect(store.allPaneIds().has(paneId)).toBe(false);
  });

  it('an archived coordinator is NOT the live coordinator → Start affordance shows', () => {
    const { store, paneId } = withCoordinator('proj-A');
    // Live before archiving.
    expect(findCoordinatorPane(coordinatorPanes(store), 'proj-A')?.paneId).toBe(paneId);

    store.closeAgent(paneId);
    // findCoordinatorPane ignores closed panes, so the project has no live coordinator
    // (the "Start coordinator" affordance is shown again).
    expect(findCoordinatorPane(coordinatorPanes(store), 'proj-A')).toBeNull();
  });

  it('restoring an archived coordinator resumes it as the project LIVE coordinator', () => {
    const { store, paneId } = withCoordinator('proj-A');
    const sessionId = store.session(paneId).sessionId;

    // Archive → restore round-trip.
    store.closeAgent(paneId);
    expect(findCoordinatorPane(coordinatorPanes(store), 'proj-A')).toBeNull();

    store.restoreAgent(paneId);
    const s = store.session(paneId);
    expect(s.closed).toBe(false); // live again
    expect(s.resume).toBe(true); // claude --resume <sessionId>
    expect(s.sessionId).toBe(sessionId); // same transcript continued
    expect(s.role).toBe('coordinator'); // role marker preserved
    // findCoordinatorPane finds it again → the project no longer offers "Start".
    expect(findCoordinatorPane(coordinatorPanes(store), 'proj-A')?.paneId).toBe(paneId);
  });

  // The REAL UI restore path for an ARCHIVED session is previewArchived → commitPreview
  // (the inbox's resume-on-select), NOT restoreAgent. This proves that path also brings
  // the coordinator back as the project's LIVE coordinator (findCoordinatorPane re-finds
  // it), so the single-coordinator invariant holds however the user un-archives it.
  it('the UI preview/commit restore path makes the coordinator live again', () => {
    const { store, paneId } = withCoordinator('proj-A');
    const sessionId = store.session(paneId).sessionId;

    // Archive it: no live coordinator for the project.
    store.closeAgent(paneId);
    expect(findCoordinatorPane(coordinatorPanes(store), 'proj-A')).toBeNull();

    // Selecting it for preview respawns `claude --resume`, but it stays presented as
    // Archived until a new message — yet it IS live (closed:false), so the project's
    // single-coordinator invariant already re-binds to it.
    store.previewArchived(paneId, 0);
    expect(store.session(paneId).closed).toBe(false);
    expect(store.session(paneId).preview).toBe(true);
    expect(findCoordinatorPane(coordinatorPanes(store), 'proj-A')?.paneId).toBe(paneId);

    // Committing the preview (a new message) unarchives it into a normal live agent.
    store.commitPreview(paneId);
    const s = store.session(paneId);
    expect(s.closed).toBe(false); // live
    expect(s.preview).toBeUndefined(); // no longer pinned to Archived
    expect(s.resume).toBe(true); // resumed the same transcript
    expect(s.sessionId).toBe(sessionId);
    expect(s.role).toBe('coordinator');
    // The project's live coordinator is this same pane — no second coordinator exists.
    expect(findCoordinatorPane(coordinatorPanes(store), 'proj-A')?.paneId).toBe(paneId);
  });
});
