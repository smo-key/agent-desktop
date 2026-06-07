import { describe, expect, it } from 'vitest';
import { WorkspaceStore } from './workspace.svelte';
import { leavesInOrder } from './tree';

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
    store.previewArchived(paneId, 'hash-1');
    const s = store.session(paneId);
    expect(s.closed).toBe(false);
    expect(s.resume).toBe(true);
    expect(s.preview).toBe(true);
    expect(s.previewHash).toBe('hash-1');
    expect(s.sessionId).toBe(sessionId); // same transcript

    // Committing the preview (the unarchive) drops preview state, leaving it live.
    store.commitPreview(paneId);
    const after = store.session(paneId);
    expect(after.preview).toBeUndefined();
    expect(after.previewHash).toBeUndefined();
    expect(after.closed).toBe(false);

    // Re-archiving a previewing session always clears its preview state too.
    store.previewArchived(paneId, 'hash-2');
    store.closeAgent(paneId);
    const rearchived = store.session(paneId);
    expect(rearchived.closed).toBe(true);
    expect(rearchived.resume).toBe(false);
    expect(rearchived.preview).toBeUndefined();
    expect(rearchived.previewHash).toBeUndefined();
  });

  it('A non-resumable archived session is just selected', () => {
    const { store, paneId } = withPane('/bin/zsh'); // shell pane: no session id
    expect(store.session(paneId).sessionId).toBeFalsy();

    store.closeAgent(paneId);
    // previewArchived is a no-op for a non-resumable pane — the inbox just selects it.
    store.previewArchived(paneId, 'hash-1');
    const s = store.session(paneId);
    expect(s.preview).toBeUndefined();
    expect(s.resume).toBeFalsy();
    expect(s.closed).toBe(true); // stays archived
  });
});
