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
const NOW = 1_000_000; // well past the small throttle floor (lastAttempt defaults to 0)

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ s1: { title: 'PROJ-45: Fix login', hash: 'h1' } }));

    // A fresh store mimics a cold app start (loads the durable cache on construct).
    const store = new TitleStore();
    store.refresh([pane()], () => 'h1', NOW);
    await flush();

    expect(store.titleFor('p1')).toBe('PROJ-45: Fix login');
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

// Terminal rows are titled by the same store, keyed by their TITLE KEY: a task
// terminal's stable `task:<defId>` (persisted, so a restart recovers it) and a
// bare shell's null (per-process, never written). Their change key is the list of
// commands the user typed, not screen text.
describe('TitleStore terminal titles', () => {
  const ref = (over: Partial<{ paneId: string; key: string | null; commands: string | null }> = {}) => ({
    paneId: 'tp1',
    key: null as string | null,
    commands: 'yarn test',
    ...over
  });

  it('A bare shell is titled from its recent commands', async () => {
    invokeMock.mockResolvedValue('Run the test suite');
    const store = new TitleStore();
    store.refreshTerminals([ref()], NOW);
    await flush();

    expect(invokeMock).toHaveBeenCalledWith('terminal_focus', {
      commands: 'yarn test',
      cloudFallback: false
    });
    expect(store.titleFor('tp1')).toBe('Run the test suite');
    // A per-process bare shell is never written to the durable cache.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Unchanged commands do not re-request; a NEW command does.
    invokeMock.mockClear();
    store.refreshTerminals([ref()], NOW + 60_000);
    await flush();
    expect(invokeMock).not.toHaveBeenCalled();
    invokeMock.mockResolvedValue('Inspect git history');
    store.refreshTerminals([ref({ commands: 'yarn test\ngit log' })], NOW + 120_000);
    await flush();
    expect(store.titleFor('tp1')).toBe('Inspect git history');
  });

  it('An untouched shell is never titled', async () => {
    invokeMock.mockResolvedValue('nope');
    const store = new TitleStore();
    // No typed commands (a fresh shell) and a task row (its command IS its name).
    store.refreshTerminals([ref({ commands: null }), ref({ paneId: 'tp2', key: 'task:t1', commands: null })], NOW);
    await flush();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(store.titleFor('tp1')).toBeNull();
  });

  it('A renamed terminal row keeps its custom title', async () => {
    let resolve!: (v: string) => void;
    invokeMock.mockReturnValue(new Promise<string>((r) => (resolve = r)));
    const store = new TitleStore();
    store.refreshTerminals([ref()], NOW);
    // The user renames the row while the generation is still in flight.
    store.setManualTitle('tp1', null, 'Nightly smoke run');
    resolve('Run the test suite');
    await flush();
    expect(store.titleFor('tp1')).toBe('Nightly smoke run');
    // And it is sticky: a later command change does not re-generate.
    invokeMock.mockClear();
    store.refreshTerminals([ref({ commands: 'make build' })], NOW + 60_000);
    await flush();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('A restarted task terminal recovers its custom title', async () => {
    const store = new TitleStore();
    store.setManualTitle('tp1', 'task:t1', 'Watch the dev server');
    // Restart: same task def, a BRAND NEW pane id, and a fresh store (app restart).
    const next = new TitleStore();
    next.hydrateKeys([{ paneId: 'tp9', key: 'task:t1', commands: null }]);
    expect(next.titleFor('tp9')).toBe('Watch the dev server');
    expect(store.titleFor('tp1')).toBe('Watch the dev server');
    await flush();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
