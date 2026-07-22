import { describe, expect, it, vi } from 'vitest';

// Tests for the theme settings store. The PURE `parseThemePrefs` validator is
// the focus (defaults to 'dark', tolerant of any persisted shape/unknown mode
// string). The store's save path is asserted to merge via `saveSettingsSlice`
// so it never clobbers sibling settings slices. The persist helpers are
// mocked. Tests run under Vitest's default 'node' environment (no `window`),
// which exercises the store's non-browser fallback path (`resolved` reports
// 'dark' for a 'system' selection, matching the store's documented default).

const saveSliceMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
const loadSettingsMock = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({}));
vi.mock('./persist', () => ({
  saveSettingsSlice: (...a: unknown[]) => saveSliceMock(...a),
  loadSettings: (...a: unknown[]) => loadSettingsMock(...a)
}));

import {
  parseThemePrefs,
  ThemeStore,
  DEFAULT_THEME_PREFS,
  type ThemePrefs
} from './theme.svelte';

describe('parseThemePrefs', () => {
  it('defaults to dark', () => {
    expect(DEFAULT_THEME_PREFS).toEqual({ mode: 'dark' });
  });

  it('returns the defaults for undefined / null / non-object input', () => {
    expect(parseThemePrefs(undefined)).toEqual(DEFAULT_THEME_PREFS);
    expect(parseThemePrefs(null)).toEqual(DEFAULT_THEME_PREFS);
    expect(parseThemePrefs('nope')).toEqual(DEFAULT_THEME_PREFS);
    expect(parseThemePrefs(42)).toEqual(DEFAULT_THEME_PREFS);
    expect(parseThemePrefs([])).toEqual(DEFAULT_THEME_PREFS);
  });

  it('falls back for missing / wrong-typed / unknown mode values (-> dark)', () => {
    expect(parseThemePrefs({})).toEqual({ mode: 'dark' });
    expect(parseThemePrefs({ mode: 1 })).toEqual({ mode: 'dark' });
    expect(parseThemePrefs({ mode: null })).toEqual({ mode: 'dark' });
    expect(parseThemePrefs({ mode: 'purple' })).toEqual({ mode: 'dark' });
  });

  it('reads each valid mode', () => {
    expect(parseThemePrefs({ mode: 'dark' })).toEqual({ mode: 'dark' });
    expect(parseThemePrefs({ mode: 'light' })).toEqual({ mode: 'light' });
    expect(parseThemePrefs({ mode: 'system' })).toEqual({ mode: 'system' });
  });
});

describe('ThemeStore', () => {
  it('defaults to dark on a fresh / empty settings blob', async () => {
    loadSettingsMock.mockResolvedValueOnce({});
    const store = new ThemeStore();
    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.prefs).toEqual({ mode: 'dark' });
    expect(store.resolved).toBe('dark');
  });

  it('loads via parseThemePrefs from the theme slice', async () => {
    loadSettingsMock.mockResolvedValueOnce({
      voice: { enabled: false },
      theme: { mode: 'light' }
    });
    const store = new ThemeStore();
    await store.load();
    expect(store.prefs).toEqual({ mode: 'light' });
    expect(store.resolved).toBe('light');
  });

  it("'system' resolves via the live OS preference (node env has no window -> dark)", async () => {
    loadSettingsMock.mockResolvedValueOnce({ theme: { mode: 'system' } });
    const store = new ThemeStore();
    await store.load();
    expect(store.prefs.mode).toBe('system');
    expect(store.resolved).toBe('dark');
  });

  it('setMode updates prefs immutably and saves the theme slice', () => {
    saveSliceMock.mockClear();
    const store = new ThemeStore();
    const before = store.prefs;
    store.setMode('light');
    expect(store.prefs.mode).toBe('light');
    expect(store.prefs).not.toBe(before); // immutable replacement
    expect(saveSliceMock).toHaveBeenCalledWith('theme', store.prefs);
  });

  it('save path targets the "theme" key only (does not clobber siblings)', () => {
    saveSliceMock.mockClear();
    const store = new ThemeStore();
    store.setMode('light');
    for (const call of saveSliceMock.mock.calls) {
      expect(call[0]).toBe('theme');
    }
    const saved = saveSliceMock.mock.calls.at(-1)![1] as ThemePrefs;
    expect(saved).toEqual(store.prefs);
  });
});
