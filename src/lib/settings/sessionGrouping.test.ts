import { describe, expect, it, vi } from 'vitest';

// Tests for the sessions-panel grouping settings store. The PURE
// `parseSessionGroupingPrefs` validator is the focus (defaults to `status`,
// tolerant of any persisted shape). The store's save path is asserted to merge
// via `saveSettingsSlice` so it never clobbers sibling settings slices. The
// persist helpers are mocked.

const saveSliceMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
const loadSettingsMock = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({}));
vi.mock('./persist', () => ({
  saveSettingsSlice: (...a: unknown[]) => saveSliceMock(...a),
  loadSettings: (...a: unknown[]) => loadSettingsMock(...a)
}));

import {
  parseSessionGroupingPrefs,
  SessionGroupingStore,
  DEFAULT_SESSION_GROUPING_PREFS,
  GROUPING_MODES,
  type SessionGroupingPrefs
} from './sessionGrouping.svelte';

describe('parseSessionGroupingPrefs', () => {
  it('defaults to the "status" grouping', () => {
    expect(DEFAULT_SESSION_GROUPING_PREFS).toEqual({ mode: 'status' });
    expect(GROUPING_MODES).toEqual(['status', 'date', 'none']);
  });

  it('returns the defaults for undefined / null / non-object input', () => {
    expect(parseSessionGroupingPrefs(undefined)).toEqual(DEFAULT_SESSION_GROUPING_PREFS);
    expect(parseSessionGroupingPrefs(null)).toEqual(DEFAULT_SESSION_GROUPING_PREFS);
    expect(parseSessionGroupingPrefs('nope')).toEqual(DEFAULT_SESSION_GROUPING_PREFS);
    expect(parseSessionGroupingPrefs(42)).toEqual(DEFAULT_SESSION_GROUPING_PREFS);
    expect(parseSessionGroupingPrefs([])).toEqual(DEFAULT_SESSION_GROUPING_PREFS);
  });

  it('falls back to "status" for missing / wrong-typed / unknown mode values', () => {
    expect(parseSessionGroupingPrefs({})).toEqual({ mode: 'status' });
    expect(parseSessionGroupingPrefs({ mode: 'project' })).toEqual({ mode: 'status' });
    expect(parseSessionGroupingPrefs({ mode: 1 })).toEqual({ mode: 'status' });
    expect(parseSessionGroupingPrefs({ mode: null })).toEqual({ mode: 'status' });
  });

  it('reads each known mode', () => {
    expect(parseSessionGroupingPrefs({ mode: 'status' })).toEqual({ mode: 'status' });
    expect(parseSessionGroupingPrefs({ mode: 'date' })).toEqual({ mode: 'date' });
    expect(parseSessionGroupingPrefs({ mode: 'none' })).toEqual({ mode: 'none' });
  });
});

describe('SessionGroupingStore', () => {
  it('defaults to "status" on a fresh / empty settings blob', async () => {
    loadSettingsMock.mockResolvedValueOnce({});
    const store = new SessionGroupingStore();
    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.prefs).toEqual({ mode: 'status' });
    expect(store.mode).toBe('status');
  });

  it('the grouping preference persists and normalizes', async () => {
    // Persisted: a "date" selection is restored from the sessionGrouping slice…
    loadSettingsMock.mockResolvedValueOnce({
      voice: { enabled: false },
      sessionGrouping: { mode: 'date' }
    });
    const store = new SessionGroupingStore();
    await store.load();
    expect(store.mode).toBe('date');
    // …and a malformed stored value resolves to "status".
    loadSettingsMock.mockResolvedValueOnce({ sessionGrouping: { mode: 'bogus' } });
    const store2 = new SessionGroupingStore();
    await store2.load();
    expect(store2.mode).toBe('status');
  });

  it('setMode updates prefs immutably and saves the sessionGrouping slice', () => {
    saveSliceMock.mockClear();
    const store = new SessionGroupingStore();
    const before = store.prefs;
    store.setMode('none');
    expect(store.mode).toBe('none');
    expect(store.prefs).not.toBe(before);
    expect(saveSliceMock).toHaveBeenCalledWith('sessionGrouping', store.prefs);
  });

  it('setMode ignores unknown values', () => {
    saveSliceMock.mockClear();
    const store = new SessionGroupingStore();
    store.setMode('project' as never);
    expect(store.mode).toBe('status');
    expect(saveSliceMock).not.toHaveBeenCalled();
  });

  it('save path targets the "sessionGrouping" key only (does not clobber siblings)', () => {
    saveSliceMock.mockClear();
    const store = new SessionGroupingStore();
    store.setMode('date');
    for (const call of saveSliceMock.mock.calls) expect(call[0]).toBe('sessionGrouping');
    const saved = saveSliceMock.mock.calls.at(-1)![1] as SessionGroupingPrefs;
    expect(saved).toEqual(store.prefs);
  });
});
