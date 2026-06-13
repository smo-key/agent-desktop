import { describe, expect, it, vi } from 'vitest';

// Tests for the subagents-visibility settings store. The PURE
// `parseSubagentsVisiblePrefs` validator is the focus (default ON, tolerant of any
// persisted shape). The store's save path is asserted to merge via
// `saveSettingsSlice` so it never clobbers sibling settings slices.

const saveSliceMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
const loadSettingsMock = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({}));
vi.mock('./persist', () => ({
  saveSettingsSlice: (...a: unknown[]) => saveSliceMock(...a),
  loadSettings: (...a: unknown[]) => loadSettingsMock(...a)
}));

import {
  parseSubagentsVisiblePrefs,
  SubagentsVisibleStore,
  DEFAULT_SUBAGENTS_VISIBLE_PREFS,
  type SubagentsVisiblePrefs
} from './subagentsVisible.svelte';

describe('parseSubagentsVisiblePrefs', () => {
  it('defaults to ON', () => {
    expect(DEFAULT_SUBAGENTS_VISIBLE_PREFS).toEqual({ enabled: true });
  });

  it('returns the defaults (ON) for undefined / null / non-object input', () => {
    expect(parseSubagentsVisiblePrefs(undefined)).toEqual(DEFAULT_SUBAGENTS_VISIBLE_PREFS);
    expect(parseSubagentsVisiblePrefs(null)).toEqual(DEFAULT_SUBAGENTS_VISIBLE_PREFS);
    expect(parseSubagentsVisiblePrefs('nope')).toEqual(DEFAULT_SUBAGENTS_VISIBLE_PREFS);
    expect(parseSubagentsVisiblePrefs(42)).toEqual(DEFAULT_SUBAGENTS_VISIBLE_PREFS);
    expect(parseSubagentsVisiblePrefs([])).toEqual(DEFAULT_SUBAGENTS_VISIBLE_PREFS);
  });

  it('falls back per-field for missing / wrong-typed values (-> ON)', () => {
    expect(parseSubagentsVisiblePrefs({})).toEqual({ enabled: true });
    expect(parseSubagentsVisiblePrefs({ enabled: 'yes' })).toEqual({ enabled: true });
    expect(parseSubagentsVisiblePrefs({ enabled: 1 })).toEqual({ enabled: true });
    expect(parseSubagentsVisiblePrefs({ enabled: null })).toEqual({ enabled: true });
  });

  it('reads an explicit false as OFF (hidden)', () => {
    expect(parseSubagentsVisiblePrefs({ enabled: false })).toEqual({ enabled: false });
  });
});

describe('SubagentsVisibleStore', () => {
  it('defaults to ON on a fresh / empty settings blob', async () => {
    loadSettingsMock.mockResolvedValueOnce({});
    const store = new SubagentsVisibleStore();
    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.prefs).toEqual({ enabled: true });
  });

  it('loads via parseSubagentsVisiblePrefs from the subagentsVisible slice', async () => {
    loadSettingsMock.mockResolvedValueOnce({
      autoAdvance: { enabled: true },
      subagentsVisible: { enabled: false }
    });
    const store = new SubagentsVisibleStore();
    await store.load();
    expect(store.prefs).toEqual({ enabled: false });
  });

  it('setEnabled updates prefs immutably and saves the subagentsVisible slice only', () => {
    saveSliceMock.mockClear();
    const store = new SubagentsVisibleStore();
    const before = store.prefs;
    store.setEnabled(false);
    expect(store.prefs.enabled).toBe(false);
    expect(store.prefs).not.toBe(before); // immutable replacement
    expect(saveSliceMock).toHaveBeenCalledWith('subagentsVisible', store.prefs);
    for (const call of saveSliceMock.mock.calls) {
      expect(call[0]).toBe('subagentsVisible');
    }
    const saved = saveSliceMock.mock.calls.at(-1)![1] as SubagentsVisiblePrefs;
    expect(saved).toEqual(store.prefs);
  });
});

describe('subagent visibility gating', () => {
  // The Inbox nests subagents only when this predicate holds — it mirrors the
  // `subagentGroupsFor` guard (`subagentsVisible.prefs.enabled`). Default shown.
  const subagentsShown = (prefs: SubagentsVisiblePrefs): boolean => prefs.enabled;

  // Scenario: "Subagents can be hidden by a setting that defaults to shown"
  it('Subagents can be hidden by a setting that defaults to shown', () => {
    // Fresh install: the default is ON, so subagents are shown.
    expect(subagentsShown(DEFAULT_SUBAGENTS_VISIBLE_PREFS)).toBe(true);
    // Turned off by the user: no subagents are surfaced.
    expect(subagentsShown({ enabled: false })).toBe(false);
  });
});
