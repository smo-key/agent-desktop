// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// SummaryStore persistence: a durable, sessionId-keyed cache of each agent's LAST
// assistant message, recorded while the pane is live. When a session is later
// ARCHIVED (closed) its PTY is gone, so its live `summary` is unavailable — the
// roster sub-line then falls back to this cache so an archived row still shows the
// last thing the agent said (instead of a bare "Archived" label). Mirrors the
// TitleStore persistence pattern (`#bySession` map + localStorage). Named
// `*.svelte.test.ts` so vitest compiles the store's runes.

import { SummaryStore } from './summaries.svelte';

const STORAGE_KEY = 'agent-desktop:session-summaries';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('SummaryStore', () => {
  it('records a live summary under its sessionId and reads it back', () => {
    const store = new SummaryStore();
    store.record('s1', 'I finished the parser refactor.');
    expect(store.summaryFor('s1')).toBe('I finished the parser refactor.');
  });

  it('ignores empty / whitespace-only summaries (keeps a prior one)', () => {
    const store = new SummaryStore();
    store.record('s1', 'Real message');
    store.record('s1', '   ');
    store.record('s1', '');
    expect(store.summaryFor('s1')).toBe('Real message');
  });

  it('ignores a null sessionId (nothing to key on)', () => {
    const store = new SummaryStore();
    store.record(null, 'orphan message');
    expect(store.summaryFor(null)).toBeNull();
  });

  it('returns null for an unknown session', () => {
    const store = new SummaryStore();
    expect(store.summaryFor('nope')).toBeNull();
  });

  it('persists to localStorage so a fresh store (app restart) restores it', () => {
    const first = new SummaryStore();
    first.record('s1', 'Last message before restart');
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    // A brand-new store mimics a cold app start: it loads the persisted cache.
    const second = new SummaryStore();
    expect(second.summaryFor('s1')).toBe('Last message before restart');
  });

  it('updates the cached summary as new live messages arrive', () => {
    const store = new SummaryStore();
    store.record('s1', 'first');
    store.record('s1', 'second');
    expect(store.summaryFor('s1')).toBe('second');
  });

  it('survives a corrupt localStorage value (starts empty, no throw)', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const store = new SummaryStore();
    expect(store.summaryFor('s1')).toBeNull();
    // Still usable afterwards.
    store.record('s1', 'ok');
    expect(store.summaryFor('s1')).toBe('ok');
  });
});
