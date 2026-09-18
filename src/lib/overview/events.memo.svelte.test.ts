import { describe, expect, it, vi } from 'vitest';

// EventStore memoization (performance): the derived per-pane activity is
// recomputed only when that pane's timeline changes, and a periodic re-seed that
// returns exactly what the store already holds writes nothing.

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { EventStore } from './events.svelte';

const ev = (paneId: string, hookEventName: string, ts: number, extra: Record<string, unknown> = {}) => ({
  paneId,
  sessionId: 's-' + paneId,
  hookEventName,
  ts,
  ...extra
});

describe('EventStore memoizes derived activity per pane', () => {
  it('activityFor returns the same object while the timeline is unchanged', () => {
    const store = new EventStore();
    store.ingest(ev('p1', 'UserPromptSubmit', 1));
    store.ingest(ev('p2', 'UserPromptSubmit', 1));
    const a1 = store.activityFor('p1');
    const a2 = store.activityFor('p2');
    expect(store.activityFor('p1')).toBe(a1);
    expect(store.activityMap().p1).toBe(a1);

    store.ingest(ev('p2', 'PreToolUse', 2, { toolName: 'Read' }));
    expect(store.activityFor('p1')).toBe(a1); // untouched pane: same object
    expect(store.activityFor('p2')).not.toBe(a2);
    expect(store.activityFor('p2').status).toBe('working');
  });

  it('seed skips the reactive write when the snapshot equals what is held', async () => {
    const store = new EventStore();
    store.ingest(ev('p1', 'UserPromptSubmit', 1));
    store.ingest(ev('p1', 'Stop', 2));
    const held = store.byPane.p1;
    const activity = store.activityFor('p1');

    invokeMock.mockResolvedValueOnce({ p1: [ev('p1', 'UserPromptSubmit', 1), ev('p1', 'Stop', 2)] });
    await store.seed([{ paneId: 'p1', sessionId: 's-p1', cwd: null }]);
    expect(store.byPane.p1).toBe(held);
    expect(store.activityFor('p1')).toBe(activity);

    // A genuinely newer snapshot still lands.
    invokeMock.mockResolvedValueOnce({
      p1: [ev('p1', 'UserPromptSubmit', 1), ev('p1', 'Stop', 2), ev('p1', 'UserPromptSubmit', 3)]
    });
    await store.seed([{ paneId: 'p1', sessionId: 's-p1', cwd: null }]);
    expect(store.byPane.p1).not.toBe(held);
    expect(store.timeline('p1')).toHaveLength(3);
  });
});
