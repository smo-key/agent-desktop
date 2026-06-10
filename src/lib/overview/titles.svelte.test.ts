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

describe('TitleStore manual (custom) titles', () => {
  it('setManualTitle sets the shown title, marks it manual, and PERSISTS it under sessionId', () => {
    const store = new TitleStore();
    store.setManualTitle('p1', 's1', '  Pay flow refactor  ');

    // Shown immediately (and trimmed).
    expect(store.titleFor('p1')).toBe('Pay flow refactor');

    // Persisted under the sessionId, marked manual.
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) as string);
    expect(saved.s1).toEqual({ title: 'Pay flow refactor', hash: null, manual: true });
  });

  it('restores a manual title from persistence on a fresh start (NO model call)', async () => {
    // A prior session set a custom title; it was persisted as manual.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ s1: { title: 'Custom focus', hash: null, manual: true } }));

    // Cold start: hydrate (cold path) shows it with no userHash and no model call.
    const store = new TitleStore();
    store.hydrate([pane()]);
    expect(store.titleFor('p1')).toBe('Custom focus');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('is STICKY: a manual title is NEVER overwritten by auto-generation, even on a changed hash', async () => {
    invokeMock.mockResolvedValue('Auto-generated focus');

    const store = new TitleStore();
    store.setManualTitle('p1', 's1', 'Custom focus');

    // The user keeps chatting: the user hash changes (h2, h3...) — auto-gen would
    // normally re-run, but the manual marker stops it.
    store.refresh([pane()], () => 'h2', NOW);
    await flush();
    store.refresh([pane()], () => 'h3', NOW + 1);
    await flush();

    expect(invokeMock).not.toHaveBeenCalled(); // auto-generation stopped
    expect(store.titleFor('p1')).toBe('Custom focus'); // custom title held
  });

  it('a restored manual title also blocks auto-generation after restart', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ s1: { title: 'Sticky title', hash: 'h1', manual: true } }));
    invokeMock.mockResolvedValue('Auto focus');

    const store = new TitleStore();
    store.refresh([pane()], () => 'h2', NOW); // changed hash since restart
    await flush();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(store.titleFor('p1')).toBe('Sticky title');
  });

  it('ignores an empty/whitespace custom title (does not overwrite or persist)', () => {
    const store = new TitleStore();
    store.setManualTitle('p1', 's1', '   ');
    expect(store.titleFor('p1')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('an IN-FLIGHT auto-fetch that resolves AFTER a rename does NOT clobber the custom title', async () => {
    // The auto-fetch is in flight (resolves on the next tick); the user renames
    // before it lands. The stale auto title must be discarded, not applied.
    let resolveFetch!: (t: string) => void;
    invokeMock.mockReturnValue(new Promise<string>((res) => (resolveFetch = res)));

    const store = new TitleStore();
    store.refresh([pane()], () => 'h1', NOW); // kicks off #fetch (now pending)

    // User renames while the fetch is still awaiting.
    store.setManualTitle('p1', 's1', 'Custom focus');
    expect(store.titleFor('p1')).toBe('Custom focus');

    // The stale auto-fetch finally resolves — it must NOT overwrite the manual title.
    resolveFetch('Auto focus');
    await flush();

    expect(store.titleFor('p1')).toBe('Custom focus');
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) as string);
    expect(saved.s1).toEqual({ title: 'Custom focus', hash: null, manual: true });
  });
});
