import { describe, expect, it, vi } from 'vitest';

// Tests for the keep-awake settings store. The PURE `parseKeepAwakePrefs`
// validator (defaults to `never`, tolerant of any persisted shape) and the PURE
// `shouldKeepAwake` policy are the focus. The store's save path is asserted to
// merge via `saveSettingsSlice` so it never clobbers sibling settings slices.
// The persist helpers are mocked.

const saveSliceMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
const loadSettingsMock = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({}));
vi.mock('./persist', () => ({
  saveSettingsSlice: (...a: unknown[]) => saveSliceMock(...a),
  loadSettings: (...a: unknown[]) => loadSettingsMock(...a)
}));

import {
  parseKeepAwakePrefs,
  shouldKeepAwake,
  KeepAwakeStore,
  DEFAULT_KEEP_AWAKE_PREFS,
  KEEP_AWAKE_MODES,
  type KeepAwakePrefs
} from './keepAwake.svelte';

describe('KeepAwakeStore', () => {
  it('Keep-awake preference persists in settings', async () => {
    expect(DEFAULT_KEEP_AWAKE_PREFS).toEqual({ mode: 'never' });
    expect(KEEP_AWAKE_MODES).toEqual(['never', 'agent-running', 'app-open']);

    // A fresh / empty settings blob yields the default.
    loadSettingsMock.mockResolvedValueOnce({});
    const fresh = new KeepAwakeStore();
    await fresh.load();
    expect(fresh.loaded).toBe(true);
    expect(fresh.mode).toBe('never');

    // Selecting a mode updates prefs immutably and saves the keepAwake slice only.
    saveSliceMock.mockClear();
    const store = new KeepAwakeStore();
    const before = store.prefs;
    store.setMode('app-open');
    expect(store.mode).toBe('app-open');
    expect(store.prefs).not.toBe(before);
    expect(saveSliceMock).toHaveBeenCalledWith('keepAwake', { mode: 'app-open' });
    for (const call of saveSliceMock.mock.calls) expect(call[0]).toBe('keepAwake');
    const saved = saveSliceMock.mock.calls.at(-1)![1] as KeepAwakePrefs;
    expect(saved).toEqual(store.prefs);

    // Unknown values are ignored and not persisted.
    saveSliceMock.mockClear();
    store.setMode('sometimes' as never);
    expect(store.mode).toBe('app-open');
    expect(saveSliceMock).not.toHaveBeenCalled();

    // A persisted selection is restored from the keepAwake slice on load.
    loadSettingsMock.mockResolvedValueOnce({
      voice: { enabled: false },
      keepAwake: { mode: 'agent-running' }
    });
    const restored = new KeepAwakeStore();
    await restored.load();
    expect(restored.mode).toBe('agent-running');
    expect(restored.prefs).toEqual({ mode: 'agent-running' });
  });

  it('Malformed keep-awake preference falls back to never', async () => {
    // Pure validator: non-objects, arrays, missing / wrong-typed / unknown modes.
    expect(parseKeepAwakePrefs(undefined)).toEqual(DEFAULT_KEEP_AWAKE_PREFS);
    expect(parseKeepAwakePrefs(null)).toEqual(DEFAULT_KEEP_AWAKE_PREFS);
    expect(parseKeepAwakePrefs('nope')).toEqual(DEFAULT_KEEP_AWAKE_PREFS);
    expect(parseKeepAwakePrefs(42)).toEqual(DEFAULT_KEEP_AWAKE_PREFS);
    expect(parseKeepAwakePrefs([])).toEqual(DEFAULT_KEEP_AWAKE_PREFS);
    expect(parseKeepAwakePrefs({})).toEqual({ mode: 'never' });
    expect(parseKeepAwakePrefs({ mode: 'always' })).toEqual({ mode: 'never' });
    expect(parseKeepAwakePrefs({ mode: 1 })).toEqual({ mode: 'never' });
    expect(parseKeepAwakePrefs({ mode: null })).toEqual({ mode: 'never' });
    expect(parseKeepAwakePrefs({ mode: true })).toEqual({ mode: 'never' });
    // Known modes still round-trip.
    expect(parseKeepAwakePrefs({ mode: 'never' })).toEqual({ mode: 'never' });
    expect(parseKeepAwakePrefs({ mode: 'agent-running' })).toEqual({ mode: 'agent-running' });
    expect(parseKeepAwakePrefs({ mode: 'app-open' })).toEqual({ mode: 'app-open' });

    // Through the store: a missing slice and a malformed one both load as `never`.
    loadSettingsMock.mockResolvedValueOnce({ voice: { enabled: false } });
    const missing = new KeepAwakeStore();
    await missing.load();
    expect(missing.mode).toBe('never');

    loadSettingsMock.mockResolvedValueOnce({ keepAwake: { mode: 'bogus' } });
    const unknown = new KeepAwakeStore();
    await unknown.load();
    expect(unknown.mode).toBe('never');

    loadSettingsMock.mockResolvedValueOnce({ keepAwake: 'app-open' });
    const nonObject = new KeepAwakeStore();
    await nonObject.load();
    expect(nonObject.mode).toBe('never');

    loadSettingsMock.mockResolvedValueOnce({ keepAwake: ['app-open'] });
    const array = new KeepAwakeStore();
    await array.load();
    expect(array.mode).toBe('never');

    loadSettingsMock.mockResolvedValueOnce({ keepAwake: { mode: 7 } });
    const wrongType = new KeepAwakeStore();
    await wrongType.load();
    expect(wrongType.mode).toBe('never');
  });
});

describe('shouldKeepAwake', () => {
  it('Never mode never holds the inhibitor', () => {
    expect(shouldKeepAwake('never', true)).toBe(false);
    expect(shouldKeepAwake('never', false)).toBe(false);
  });

  it('App-open mode holds the inhibitor while the app runs', () => {
    expect(shouldKeepAwake('app-open', false)).toBe(true);
    expect(shouldKeepAwake('app-open', true)).toBe(true);
  });

  it('Agent-running mode holds the inhibitor only while an agent is In flight', () => {
    expect(shouldKeepAwake('agent-running', true)).toBe(true);
    expect(shouldKeepAwake('agent-running', false)).toBe(false);
  });
});
