import { describe, expect, it, vi } from 'vitest';
import { WorkspaceStore, sessionCwd } from './workspace.svelte';
import { leavesInOrder } from './tree';

// `@tauri-apps/api/core` is stubbed so any stray `invoke` from the store stays
// inert (resolves to null) without a live Tauri backend, mirroring the other
// tests that stub it (recents, projectTasks).
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

describe('workspace — copilot panes are first-class agent panes (agent-backends)', () => {
  it('Persisted panes keep their backend', () => {
    // A copilot pane mints an app-owned session id at launch (same contract as
    // claude) and archive → restore resumes it AS a copilot pane.
    const { store, paneId } = withPane('copilot');
    const s0 = store.session(paneId);
    expect(s0.program).toBe('copilot');
    expect(s0.sessionId).toBeTruthy();

    store.closeAgent(paneId);
    store.restoreAgent(paneId);
    const s1 = store.session(paneId);
    expect(s1.program).toBe('copilot');
    expect(s1.closed).toBe(false);
    expect(s1.resume).toBe(true); // copilot --resume <sessionId>
    expect(s1.sessionId).toBe(s0.sessionId);
  });

  it('preview/commit restore works for an archived copilot pane', () => {
    const { store, paneId } = withPane('copilot');
    const sessionId = store.session(paneId).sessionId;
    store.closeAgent(paneId);
    store.previewArchived(paneId, 2);
    const s = store.session(paneId);
    expect(s.closed).toBe(false);
    expect(s.resume).toBe(true);
    expect(s.preview).toBe(true);
    expect(s.sessionId).toBe(sessionId);
  });

  it('shell panes still mint no session id', () => {
    const { store, paneId } = withPane('/bin/zsh');
    expect(store.session(paneId).sessionId).toBeUndefined();
  });
});

// session-launcher: "Launch A Session In A New Git Worktree" — the worktree flag is
// FIRST-SPAWN only. Archiving strips it, so the one in-session respawn path (an
// archived session previewed with `--resume`) can never create a second worktree.
describe('workspace — worktree launch args are first-spawn only', () => {
  it('Worktree flag is not re-applied when an archived session is previewed', () => {
    const store = new WorkspaceStore();
    const paneId = store.launch({
      program: 'claude',
      cwd: '/proj',
      placement: 'tab',
      launchArgs: ['--worktree', 'feature-x']
    });
    expect(store.session(paneId).launchArgs).toEqual(['--worktree', 'feature-x']);
    store.closeAgent(paneId);
    expect(store.session(paneId).launchArgs).toBeUndefined();
    store.previewArchived(paneId, 1);
    const s = store.session(paneId);
    expect(s.launchArgs).toBeUndefined();
    expect(s.resume).toBe(true);
    // An empty list is normalized away at launch.
    const plain = store.launch({ program: 'claude', cwd: '/proj', placement: 'tab', launchArgs: [] });
    expect(store.session(plain).launchArgs).toBeUndefined();
  });
});

// session-launcher: "A worktree session resumes in its worktree" — `claude
// --worktree` makes the worktree itself, so the dir the session ends up in is
// learned at runtime and then kept, including across archive → preview.
describe('workspace — an adopted worktree dir is kept', () => {
  it('A worktree session keeps its dir through archive and preview', () => {
    const store = new WorkspaceStore();
    const paneId = store.launch({
      program: 'claude',
      cwd: '/proj',
      placement: 'tab',
      launchArgs: ['--worktree', 'feature-x']
    });
    store.adoptWorktreeCwd(paneId, '/proj/.claude/worktrees/feature-x');
    expect(sessionCwd(store.session(paneId))).toBe('/proj/.claude/worktrees/feature-x');

    // Adoption happens ONCE: a session that later `cd`s cannot move its pane.
    store.adoptWorktreeCwd(paneId, '/somewhere/else');
    expect(store.session(paneId).worktreeCwd).toBe('/proj/.claude/worktrees/feature-x');

    // Archiving strips the launch FLAG (no second worktree) but keeps the DIR, so
    // the preview respawn resumes inside the worktree rather than the project.
    store.closeAgent(paneId);
    expect(store.session(paneId).launchArgs).toBeUndefined();
    store.previewArchived(paneId, 1);
    const s = store.session(paneId);
    expect(s.launchArgs).toBeUndefined();
    expect(sessionCwd(s)).toBe('/proj/.claude/worktrees/feature-x');

    // A pane with no adopted dir simply reports the dir it was launched in.
    const plain = store.launch({ program: 'claude', cwd: '/proj', placement: 'tab' });
    expect(sessionCwd(store.session(plain))).toBe('/proj');
    expect(sessionCwd(undefined)).toBeNull();
  });

  it('A worktree pane is resolvable from any workspace', () => {
    // `session()` answers for the ACTIVE workspace only and FABRICATES a login-shell
    // default otherwise — so a caller keyed off the snapshot map (which spans every
    // workspace) must use `sessionAnywhere`, or a worktree session sitting in a
    // background tab is never adopted and its subagent watch is dropped.
    const store = new WorkspaceStore();
    const paneId = store.launch({
      program: 'claude',
      cwd: '/proj',
      placement: 'tab',
      launchArgs: ['--worktree']
    });
    store.adoptWorktreeCwd(paneId, '/proj/.claude/worktrees/feature-x');
    store.newWorkspace(); // the worktree pane's workspace is no longer active

    expect(store.session(paneId).cwd).toBeNull(); // the fabricated default
    expect(store.sessionAnywhere(paneId)?.cwd).toBe('/proj');
    expect(sessionCwd(store.sessionAnywhere(paneId))).toBe('/proj/.claude/worktrees/feature-x');
    expect(store.sessionAnywhere('pane-does-not-exist')).toBeNull();
  });

  it('A pane forgets a worktree dir that no longer exists', () => {
    const store = new WorkspaceStore();
    const paneId = store.launch({
      program: 'claude',
      cwd: '/proj',
      placement: 'tab',
      launchArgs: ['--worktree']
    });
    store.adoptWorktreeCwd(paneId, '/proj/.claude/worktrees/gone');
    store.clearWorktreeCwd(paneId);
    expect(store.session(paneId).worktreeCwd).toBeUndefined();
    // Back to the folder it was launched in, so it can spawn again.
    expect(sessionCwd(store.session(paneId))).toBe('/proj');
    store.clearWorktreeCwd(paneId); // idempotent
    store.clearWorktreeCwd('nope'); // unknown pane is a no-op
  });

  it('A split inherits the focused pane worktree', () => {
    // Splitting next to a worktree agent is how you run git against ITS branch, so
    // the new shell must open in the worktree, not on the main checkout.
    const store = new WorkspaceStore();
    const paneId = store.launch({
      program: 'claude',
      cwd: '/proj',
      placement: 'tab',
      launchArgs: ['--worktree']
    });
    store.adoptWorktreeCwd(paneId, '/proj/.claude/worktrees/feature-x');
    store.split('row');
    // The split's new pane is the login shell that is not the agent pane.
    const shellPane = Object.entries(store.active?.registry ?? {}).find(
      ([id, sess]) => id !== paneId && sess.program !== 'claude'
    );
    expect(shellPane).toBeDefined();
    expect(shellPane?.[1].cwd).toBe('/proj/.claude/worktrees/feature-x');
  });
});
