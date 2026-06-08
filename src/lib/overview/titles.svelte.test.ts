// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// TitleStore persistence: the durable, sessionId-keyed title cache in
// localStorage is what makes "close + reopen the app" NOT re-call the model. On
// restart each claude pane re-spawns with its SAME persisted sessionId, so it
// reads the same transcript and reports the same userHash; the cached
// {title, hash} is seeded into byPane and the user-hash gate short-circuits the
// model call. These tests pin that contract (the pure gate itself lives in
// titles.test.ts). Named `*.svelte.test.ts` so vitest compiles the store's runes.

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { TitleStore } from './titles.svelte';
import type { PaneRef } from './activity.svelte';

const STORAGE_KEY = 'agent-desktop:session-titles';
const NOW = 1_000_000; // well past the throttle window (lastAttempt defaults to 0)

const pane = (over: Partial<PaneRef> = {}): PaneRef => ({
  paneId: 'p1',
  sessionId: 's1',
  cwd: null,
  ...over
});

/** Let the fire-and-forget `#fetch` settle (it `await`s the mocked invoke). */
const flush = () => new Promise((r) => setTimeout(r));

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
});

afterEach(() => {
  localStorage.clear();
});

describe('TitleStore restart persistence', () => {
  it('seeds a restored agent from cache and makes NO model call when its messages are unchanged', async () => {
    // Simulate a prior session: the title for s1@h1 was generated and persisted.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ s1: { title: 'SKIPA-45: Fix Feature', hash: 'h1' } }));

    // A fresh store mimics a cold app start (loads the durable cache on construct).
    const store = new TitleStore();
    store.refresh([pane()], () => 'h1', NOW);
    await flush();

    expect(store.titleFor('p1')).toBe('SKIPA-45: Fix Feature');
    expect(invokeMock).not.toHaveBeenCalled(); // the whole point: no model re-call
  });

  it('regenerates after restart only when the user messages actually changed', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ s1: { title: 'Old focus', hash: 'h1' } }));
    invokeMock.mockResolvedValue('New focus');

    const store = new TitleStore();
    // The transcript grew since we titled it: userHash is now h2, not the cached h1.
    store.refresh([pane()], () => 'h2', NOW);
    await flush();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(store.titleFor('p1')).toBe('New focus');
  });

  it('persists a freshly generated title so the NEXT app start reuses it (still no model call)', async () => {
    invokeMock.mockResolvedValue('Improve frontend dialog handling');

    // First run: no cache, so it calls the model once and persists the result.
    const first = new TitleStore();
    first.refresh([pane()], () => 'h1', NOW);
    await flush();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // Second app start: a brand-new store reads what the first run persisted.
    const second = new TitleStore();
    second.refresh([pane()], () => 'h1', NOW);
    await flush();

    expect(second.titleFor('p1')).toBe('Improve frontend dialog handling');
    expect(invokeMock).toHaveBeenCalledTimes(1); // still 1 — the reopen reused the cache
  });

  it('hydrate() seeds the cached title with NO poll and NO model call (no userHash needed)', () => {
    // This is the cold-open path: before the first activity poll there is no
    // userHash yet, but the card must still show its real title, not "Session N".
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ s1: { title: 'Wire footer git counts', hash: 'h1' } }));

    const store = new TitleStore();
    expect(store.titleFor('p1')).toBeNull(); // nothing seeded until we hydrate
    store.hydrate([pane()]); // synchronous — no hashOf, no await
    expect(store.titleFor('p1')).toBe('Wire footer git counts');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('does not persist a null title (a failed/empty generation is not cached)', async () => {
    invokeMock.mockResolvedValue(null);

    const store = new TitleStore();
    store.refresh([pane()], () => 'h1', NOW);
    await flush();

    expect(store.titleFor('p1')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull(); // nothing worth persisting
  });
});
