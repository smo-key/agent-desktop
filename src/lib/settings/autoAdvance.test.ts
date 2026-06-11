import { describe, expect, it, vi } from 'vitest';

// Tests for the auto-advance settings store. The PURE `parseAutoAdvancePrefs`
// validator is the focus (default OFF, tolerant of any persisted shape). The
// store's save path is asserted to merge via `saveSettingsSlice` so it never
// clobbers sibling settings slices. The persist helpers are mocked. A small
// gating test asserts the predicate the Inbox uses: auto-advance is suppressed
// when `enabled` is false and permitted when true.

const saveSliceMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
const loadSettingsMock = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({}));
vi.mock('./persist', () => ({
  saveSettingsSlice: (...a: unknown[]) => saveSliceMock(...a),
  loadSettings: (...a: unknown[]) => loadSettingsMock(...a)
}));

import {
  parseAutoAdvancePrefs,
  AutoAdvanceStore,
  DEFAULT_AUTO_ADVANCE_PREFS,
  type AutoAdvancePrefs
} from './autoAdvance.svelte';

describe('parseAutoAdvancePrefs', () => {
  it('defaults to OFF', () => {
    expect(DEFAULT_AUTO_ADVANCE_PREFS).toEqual({ enabled: false });
  });

  it('returns the defaults for undefined / null / non-object input', () => {
    expect(parseAutoAdvancePrefs(undefined)).toEqual(DEFAULT_AUTO_ADVANCE_PREFS);
    expect(parseAutoAdvancePrefs(null)).toEqual(DEFAULT_AUTO_ADVANCE_PREFS);
    expect(parseAutoAdvancePrefs('nope')).toEqual(DEFAULT_AUTO_ADVANCE_PREFS);
    expect(parseAutoAdvancePrefs(42)).toEqual(DEFAULT_AUTO_ADVANCE_PREFS);
    expect(parseAutoAdvancePrefs([])).toEqual(DEFAULT_AUTO_ADVANCE_PREFS);
  });

  it('falls back per-field for missing / wrong-typed values (-> OFF)', () => {
    expect(parseAutoAdvancePrefs({})).toEqual({ enabled: false });
    expect(parseAutoAdvancePrefs({ enabled: 'yes' })).toEqual({ enabled: false });
    expect(parseAutoAdvancePrefs({ enabled: 1 })).toEqual({ enabled: false });
    expect(parseAutoAdvancePrefs({ enabled: null })).toEqual({ enabled: false });
  });

  it('reads a truthy boolean as ON', () => {
    expect(parseAutoAdvancePrefs({ enabled: true })).toEqual({ enabled: true });
  });

  it('reads an explicit false as OFF', () => {
    expect(parseAutoAdvancePrefs({ enabled: false })).toEqual({ enabled: false });
  });
});

describe('AutoAdvanceStore', () => {
  it('defaults to OFF on a fresh / empty settings blob', async () => {
    loadSettingsMock.mockResolvedValueOnce({});
    const store = new AutoAdvanceStore();
    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.prefs).toEqual({ enabled: false });
  });

  it('loads via parseAutoAdvancePrefs from the autoAdvance slice', async () => {
    loadSettingsMock.mockResolvedValueOnce({
      voice: { enabled: false },
      autoAdvance: { enabled: true }
    });
    const store = new AutoAdvanceStore();
    await store.load();
    expect(store.prefs).toEqual({ enabled: true });
  });

  it('setEnabled updates prefs immutably and saves the autoAdvance slice', () => {
    saveSliceMock.mockClear();
    const store = new AutoAdvanceStore();
    const before = store.prefs;
    store.setEnabled(true);
    expect(store.prefs.enabled).toBe(true);
    expect(store.prefs).not.toBe(before); // immutable replacement
    expect(saveSliceMock).toHaveBeenCalledWith('autoAdvance', store.prefs);
  });

  it('save path targets the "autoAdvance" key only (does not clobber siblings)', () => {
    saveSliceMock.mockClear();
    const store = new AutoAdvanceStore();
    store.setEnabled(true);
    for (const call of saveSliceMock.mock.calls) {
      expect(call[0]).toBe('autoAdvance');
    }
    const saved = saveSliceMock.mock.calls.at(-1)![1] as AutoAdvancePrefs;
    expect(saved).toEqual(store.prefs);
  });
});

describe('auto-advance gating predicate', () => {
  // The Inbox arms its grace timer / advance only when this predicate holds.
  // It mirrors the condition added to the advance effect: an agent that JUST
  // left attention should advance to the next waiting agent ONLY when the
  // setting is enabled. Manual nav does not consult this.
  const shouldArmAdvance = (prefs: AutoAdvancePrefs, leftAttention: boolean): boolean =>
    prefs.enabled && leftAttention;

  it('does NOT auto-advance when the setting is OFF, even after leaving attention', () => {
    expect(shouldArmAdvance({ enabled: false }, true)).toBe(false);
  });

  it('DOES auto-advance when the setting is ON and the agent left attention', () => {
    expect(shouldArmAdvance({ enabled: true }, true)).toBe(true);
  });

  it('never auto-advances when the agent did not leave attention, regardless of setting', () => {
    expect(shouldArmAdvance({ enabled: true }, false)).toBe(false);
    expect(shouldArmAdvance({ enabled: false }, false)).toBe(false);
  });
});
