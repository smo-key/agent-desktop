import { describe, expect, it, vi } from 'vitest';

// Tests for the limit-reset countdown settings store. The PURE
// `parseLimitResetPrefs` validator is the focus (default OFF, tolerant of any
// persisted shape). The store's save path is asserted to merge via
// `saveSettingsSlice` so it never clobbers sibling settings slices. The persist
// helpers are mocked.

const saveSliceMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
const loadSettingsMock = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({}));
vi.mock('./persist', () => ({
  saveSettingsSlice: (...a: unknown[]) => saveSliceMock(...a),
  loadSettings: (...a: unknown[]) => loadSettingsMock(...a)
}));

import {
  parseLimitResetPrefs,
  LimitResetStore,
  DEFAULT_LIMIT_RESET_PREFS,
  type LimitResetPrefs
} from './limitReset.svelte';

describe('parseLimitResetPrefs', () => {
  it('defaults to OFF', () => {
    expect(DEFAULT_LIMIT_RESET_PREFS).toEqual({ enabled: false });
  });

  it('returns the defaults for undefined / null / non-object input', () => {
    expect(parseLimitResetPrefs(undefined)).toEqual(DEFAULT_LIMIT_RESET_PREFS);
    expect(parseLimitResetPrefs(null)).toEqual(DEFAULT_LIMIT_RESET_PREFS);
    expect(parseLimitResetPrefs('nope')).toEqual(DEFAULT_LIMIT_RESET_PREFS);
    expect(parseLimitResetPrefs(42)).toEqual(DEFAULT_LIMIT_RESET_PREFS);
    expect(parseLimitResetPrefs([])).toEqual(DEFAULT_LIMIT_RESET_PREFS);
  });

  it('falls back per-field for missing / wrong-typed values (-> OFF)', () => {
    expect(parseLimitResetPrefs({})).toEqual({ enabled: false });
    expect(parseLimitResetPrefs({ enabled: 'yes' })).toEqual({ enabled: false });
    expect(parseLimitResetPrefs({ enabled: 1 })).toEqual({ enabled: false });
    expect(parseLimitResetPrefs({ enabled: null })).toEqual({ enabled: false });
  });

  it('reads booleans through', () => {
    expect(parseLimitResetPrefs({ enabled: true })).toEqual({ enabled: true });
    expect(parseLimitResetPrefs({ enabled: false })).toEqual({ enabled: false });
  });
});

describe('LimitResetStore', () => {
  it('defaults to OFF on a fresh / empty settings blob', async () => {
    loadSettingsMock.mockResolvedValueOnce({});
    const store = new LimitResetStore();
    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.prefs).toEqual({ enabled: false });
  });

  it('loads via parseLimitResetPrefs from the limitReset slice', async () => {
    loadSettingsMock.mockResolvedValueOnce({
      voice: { enabled: false },
      limitReset: { enabled: true }
    });
    const store = new LimitResetStore();
    await store.load();
    expect(store.prefs).toEqual({ enabled: true });
  });

  it('setEnabled updates prefs immutably and saves the limitReset slice', () => {
    saveSliceMock.mockClear();
    const store = new LimitResetStore();
    const before = store.prefs;
    store.setEnabled(true);
    expect(store.prefs.enabled).toBe(true);
    expect(store.prefs).not.toBe(before); // immutable replacement
    expect(saveSliceMock).toHaveBeenCalledWith('limitReset', store.prefs);
  });

  it('save path targets the "limitReset" key only (does not clobber siblings)', () => {
    saveSliceMock.mockClear();
    const store = new LimitResetStore();
    store.setEnabled(true);
    for (const call of saveSliceMock.mock.calls) {
      expect(call[0]).toBe('limitReset');
    }
    const saved = saveSliceMock.mock.calls.at(-1)![1] as LimitResetPrefs;
    expect(saved).toEqual(store.prefs);
  });
});
