import { describe, expect, it, vi } from 'vitest';
import { WorkspaceStore } from './workspace.svelte';
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
