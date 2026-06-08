import { describe, expect, it, vi } from 'vitest';

// Tests for the session-title settings store. The PURE `parseTitlePrefs` validator
// is the focus (default + tolerant of any persisted shape). The store's save path
// is asserted to merge via `saveSettingsSlice('titles', …)` so it never clobbers
// sibling settings slices (voice, openWith). The persist helpers are mocked.

const saveSliceMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
const loadSettingsMock = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({}));
vi.mock('./persist', () => ({
  saveSettingsSlice: (...a: unknown[]) => saveSliceMock(...a),
  loadSettings: (...a: unknown[]) => loadSettingsMock(...a)
}));

import {
  parseTitlePrefs,
  TitleSettingsStore,
  DEFAULT_TITLE_PREFS,
  type TitlePrefs
} from './titles.svelte';

describe('parseTitlePrefs', () => {
  it('returns the defaults for undefined / null / non-object input', () => {
    expect(parseTitlePrefs(undefined)).toEqual(DEFAULT_TITLE_PREFS);
    expect(parseTitlePrefs(null)).toEqual(DEFAULT_TITLE_PREFS);
    expect(parseTitlePrefs('nope')).toEqual(DEFAULT_TITLE_PREFS);
    expect(parseTitlePrefs(42)).toEqual(DEFAULT_TITLE_PREFS);
    expect(parseTitlePrefs([])).toEqual(DEFAULT_TITLE_PREFS);
  });

  it('defaults cloudFallback OFF (on-device-only privacy posture)', () => {
    expect(DEFAULT_TITLE_PREFS.cloudFallback).toBe(false);
    expect(parseTitlePrefs({}).cloudFallback).toBe(false);
  });

  it('reads a fully-specified valid slice', () => {
    expect(parseTitlePrefs({ cloudFallback: true })).toEqual({ cloudFallback: true });
  });

  it('falls back per-field for wrong-typed values', () => {
    expect(parseTitlePrefs({ cloudFallback: 'yes' })).toEqual(DEFAULT_TITLE_PREFS);
    expect(parseTitlePrefs({ cloudFallback: 1 })).toEqual(DEFAULT_TITLE_PREFS);
  });
});

describe('TitleSettingsStore', () => {
  it('loads via parseTitlePrefs from the titles slice', async () => {
    loadSettingsMock.mockResolvedValueOnce({
      voice: { enabled: false },
      titles: { cloudFallback: true }
    });
    const store = new TitleSettingsStore();
    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.prefs).toEqual({ cloudFallback: true });
  });

  it('defaults on a fresh / empty settings blob', async () => {
    loadSettingsMock.mockResolvedValueOnce({});
    const store = new TitleSettingsStore();
    await store.load();
    expect(store.prefs).toEqual(DEFAULT_TITLE_PREFS);
  });

  it('setCloudFallback updates prefs immutably and saves the titles slice', () => {
    saveSliceMock.mockClear();
    const store = new TitleSettingsStore();
    const before = store.prefs;
    store.setCloudFallback(true);
    expect(store.prefs.cloudFallback).toBe(true);
    expect(store.prefs).not.toBe(before); // immutable replacement
    expect(saveSliceMock).toHaveBeenCalledWith('titles', store.prefs);
  });

  it('save path targets the "titles" key only (does not clobber siblings)', () => {
    saveSliceMock.mockClear();
    const store = new TitleSettingsStore();
    store.setCloudFallback(true);
    for (const call of saveSliceMock.mock.calls) {
      expect(call[0]).toBe('titles');
    }
    const saved = saveSliceMock.mock.calls.at(-1)![1] as TitlePrefs;
    expect(saved).toEqual(store.prefs);
  });
});
