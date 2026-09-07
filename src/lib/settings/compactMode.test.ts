import { describe, expect, it, vi } from 'vitest';

// Tests for the sessions-panel density settings store. The PURE
// `parseCompactModePrefs` validator is the focus (default "default", tolerant of
// any persisted shape, migrates the legacy `{ enabled }` boolean). The store's
// save path is asserted to merge via `saveSettingsSlice` so it never clobbers
// sibling settings slices. The persist helpers are mocked.

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
  DENSITIES,
  type CompactModePrefs
} from './compactMode.svelte';

describe('parseCompactModePrefs', () => {
  it('defaults to the "default" density', () => {
    expect(DEFAULT_COMPACT_MODE_PREFS).toEqual({ density: 'default' });
    expect(DENSITIES).toEqual(['default', 'compact', 'minimal']);
  });

  it('returns the defaults for undefined / null / non-object input', () => {
    expect(parseCompactModePrefs(undefined)).toEqual(DEFAULT_COMPACT_MODE_PREFS);
    expect(parseCompactModePrefs(null)).toEqual(DEFAULT_COMPACT_MODE_PREFS);
    expect(parseCompactModePrefs('nope')).toEqual(DEFAULT_COMPACT_MODE_PREFS);
    expect(parseCompactModePrefs(42)).toEqual(DEFAULT_COMPACT_MODE_PREFS);
    expect(parseCompactModePrefs([])).toEqual(DEFAULT_COMPACT_MODE_PREFS);
  });

  it('falls back to "default" for missing / wrong-typed / unknown density values', () => {
    expect(parseCompactModePrefs({})).toEqual({ density: 'default' });
    expect(parseCompactModePrefs({ density: 'huge' })).toEqual({ density: 'default' });
    expect(parseCompactModePrefs({ density: 1 })).toEqual({ density: 'default' });
    expect(parseCompactModePrefs({ density: null })).toEqual({ density: 'default' });
  });

  it('reads each known density', () => {
    expect(parseCompactModePrefs({ density: 'default' })).toEqual({ density: 'default' });
    expect(parseCompactModePrefs({ density: 'compact' })).toEqual({ density: 'compact' });
    expect(parseCompactModePrefs({ density: 'minimal' })).toEqual({ density: 'minimal' });
  });

  it('migrates the legacy { enabled } boolean slice', () => {
    // Pre-density installs stored `{ enabled: true }` for Compact.
    expect(parseCompactModePrefs({ enabled: true })).toEqual({ density: 'compact' });
    expect(parseCompactModePrefs({ enabled: false })).toEqual({ density: 'default' });
    // A present `density` wins over a stale legacy flag.
    expect(parseCompactModePrefs({ enabled: true, density: 'minimal' })).toEqual({
      density: 'minimal'
    });
  });
});

describe('CompactModeStore', () => {
  it('defaults to "default" density on a fresh / empty settings blob', async () => {
    loadSettingsMock.mockResolvedValueOnce({});
    const store = new CompactModeStore();
    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.prefs).toEqual({ density: 'default' });
    expect(store.enabled).toBe(false);
    expect(store.minimal).toBe(false);
  });

  it('loads via parseCompactModePrefs from the compactMode slice', async () => {
    loadSettingsMock.mockResolvedValueOnce({
      voice: { enabled: false },
      compactMode: { density: 'minimal' }
    });
    const store = new CompactModeStore();
    await store.load();
    expect(store.prefs).toEqual({ density: 'minimal' });
    expect(store.minimal).toBe(true);
    // Minimal also hides everything Compact hides.
    expect(store.enabled).toBe(true);
  });

  it('setDensity updates prefs immutably and saves the compactMode slice', () => {
    saveSliceMock.mockClear();
    const store = new CompactModeStore();
    const before = store.prefs;
    store.setDensity('compact');
    expect(store.prefs.density).toBe('compact');
    expect(store.enabled).toBe(true);
    expect(store.minimal).toBe(false);
    expect(store.prefs).not.toBe(before); // immutable replacement
    expect(saveSliceMock).toHaveBeenCalledWith('compactMode', store.prefs);
  });

  it('setDensity ignores unknown values', () => {
    saveSliceMock.mockClear();
    const store = new CompactModeStore();
    store.setDensity('huge' as never);
    expect(store.prefs.density).toBe('default');
    expect(saveSliceMock).not.toHaveBeenCalled();
  });

  it('save path targets the "compactMode" key only (does not clobber siblings)', () => {
    saveSliceMock.mockClear();
    const store = new CompactModeStore();
    store.setDensity('minimal');
    for (const call of saveSliceMock.mock.calls) {
      expect(call[0]).toBe('compactMode');
    }
    const saved = saveSliceMock.mock.calls.at(-1)![1] as CompactModePrefs;
    expect(saved).toEqual(store.prefs);
  });
});
