import { describe, expect, it, vi } from 'vitest';

// Tests for the compact-mode settings store. The PURE `parseCompactModePrefs`
// validator is the focus (default OFF, tolerant of any persisted shape). The
// store's save path is asserted to merge via `saveSettingsSlice` so it never
// clobbers sibling settings slices. The persist helpers are mocked.

const saveSliceMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
const loadSettingsMock = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({}));
vi.mock('./persist', () => ({
  saveSettingsSlice: (...a: unknown[]) => saveSliceMock(...a),
  loadSettings: (...a: unknown[]) => loadSettingsMock(...a)
}));

import {
  parseCompactModePrefs,
  CompactModeStore,
  DEFAULT_COMPACT_MODE_PREFS,
  type CompactModePrefs
} from './compactMode.svelte';

describe('parseCompactModePrefs', () => {
  it('defaults to OFF', () => {
    expect(DEFAULT_COMPACT_MODE_PREFS).toEqual({ enabled: false });
  });

  it('returns the defaults for undefined / null / non-object input', () => {
    expect(parseCompactModePrefs(undefined)).toEqual(DEFAULT_COMPACT_MODE_PREFS);
    expect(parseCompactModePrefs(null)).toEqual(DEFAULT_COMPACT_MODE_PREFS);
    expect(parseCompactModePrefs('nope')).toEqual(DEFAULT_COMPACT_MODE_PREFS);
    expect(parseCompactModePrefs(42)).toEqual(DEFAULT_COMPACT_MODE_PREFS);
    expect(parseCompactModePrefs([])).toEqual(DEFAULT_COMPACT_MODE_PREFS);
  });

  it('falls back per-field for missing / wrong-typed values (-> OFF)', () => {
    expect(parseCompactModePrefs({})).toEqual({ enabled: false });
    expect(parseCompactModePrefs({ enabled: 'yes' })).toEqual({ enabled: false });
    expect(parseCompactModePrefs({ enabled: 1 })).toEqual({ enabled: false });
    expect(parseCompactModePrefs({ enabled: null })).toEqual({ enabled: false });
  });

  it('reads a truthy boolean as ON', () => {
    expect(parseCompactModePrefs({ enabled: true })).toEqual({ enabled: true });
  });

  it('reads an explicit false as OFF', () => {
    expect(parseCompactModePrefs({ enabled: false })).toEqual({ enabled: false });
  });
});

describe('CompactModeStore', () => {
  it('defaults to OFF on a fresh / empty settings blob', async () => {
    loadSettingsMock.mockResolvedValueOnce({});
    const store = new CompactModeStore();
    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.prefs).toEqual({ enabled: false });
  });

  it('loads via parseCompactModePrefs from the compactMode slice', async () => {
    loadSettingsMock.mockResolvedValueOnce({
      voice: { enabled: false },
      compactMode: { enabled: true }
    });
    const store = new CompactModeStore();
    await store.load();
    expect(store.prefs).toEqual({ enabled: true });
  });

  it('setEnabled updates prefs immutably and saves the compactMode slice', () => {
    saveSliceMock.mockClear();
    const store = new CompactModeStore();
    const before = store.prefs;
    store.setEnabled(true);
    expect(store.prefs.enabled).toBe(true);
    expect(store.prefs).not.toBe(before); // immutable replacement
    expect(saveSliceMock).toHaveBeenCalledWith('compactMode', store.prefs);
  });

  it('save path targets the "compactMode" key only (does not clobber siblings)', () => {
    saveSliceMock.mockClear();
    const store = new CompactModeStore();
    store.setEnabled(true);
    for (const call of saveSliceMock.mock.calls) {
      expect(call[0]).toBe('compactMode');
    }
    const saved = saveSliceMock.mock.calls.at(-1)![1] as CompactModePrefs;
    expect(saved).toEqual(store.prefs);
  });
});
