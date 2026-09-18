import { describe, expect, it, vi } from 'vitest';

// ActivityStore refresh semantics (performance): a refresh over the LIVE panes
// merges into the map (closed panes keep the activity they were seeded with) and
// keeps the SAME object for a pane whose activity did not change, so downstream
// derivations see no spurious update.

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { ActivityStore } from './activity.svelte';

const panes = [{ paneId: 'p1', sessionId: 's1', cwd: '/a' }];

describe('ActivityStore.refresh merges and preserves unchanged entries', () => {
  it('Archived agents keep their seeded summary', async () => {
    const store = new ActivityStore();
    invokeMock.mockResolvedValueOnce({
      p1: { summary: 'one' },
      pClosed: { summary: 'archived summary' }
    });
    await store.refresh([...panes, { paneId: 'pClosed', sessionId: 's9', cwd: '/z' }]);
    expect(store.forPane('pClosed').summary).toBe('archived summary');

    invokeMock.mockResolvedValueOnce({ p1: { summary: 'two' } });
    await store.refresh(panes);
    expect(store.forPane('p1').summary).toBe('two');
    expect(store.forPane('pClosed').summary).toBe('archived summary');
  });

  it('returns the same object reference for a pane whose activity is unchanged', async () => {
    const store = new ActivityStore();
    invokeMock.mockResolvedValueOnce({ p1: { summary: 'same', lastMsgTs: 5 } });
    await store.refresh(panes);
    const before = store.bySession.p1;
    invokeMock.mockResolvedValueOnce({ p1: { summary: 'same', lastMsgTs: 5 } });
    await store.refresh(panes);
    expect(store.bySession.p1).toBe(before);

    invokeMock.mockResolvedValueOnce({ p1: { summary: 'changed', lastMsgTs: 6 } });
    await store.refresh(panes);
    expect(store.bySession.p1).not.toBe(before);
    expect(store.forPane('p1').summary).toBe('changed');
  });

  it('drops a refreshed pane whose transcript no longer resolves', async () => {
    const store = new ActivityStore();
    invokeMock.mockResolvedValueOnce({ p1: { summary: 'x' } });
    await store.refresh(panes);
    invokeMock.mockResolvedValueOnce({});
    await store.refresh(panes);
    expect(store.bySession.p1).toBeUndefined();
  });
});
