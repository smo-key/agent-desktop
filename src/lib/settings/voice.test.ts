import { describe, expect, it, vi } from 'vitest';

// Tests for the voice-settings store. The PURE `parseVoicePrefs` validator is the
// focus (defaults + field-by-field validation, tolerant of any persisted shape).
// The store's save path is also asserted to merge via `saveSettingsSlice` so it
// never clobbers sibling settings slices. The persist helpers are mocked.

const saveSliceMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
const loadSettingsMock = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({}));
vi.mock('./persist', () => ({
  saveSettingsSlice: (...a: unknown[]) => saveSliceMock(...a),
  loadSettings: (...a: unknown[]) => loadSettingsMock(...a)
}));

import {
  parseVoicePrefs,
  VoiceStore,
  DEFAULT_VOICE_PREFS,
  type VoicePrefs
} from './voice.svelte';

describe('parseVoicePrefs', () => {
  it('returns the defaults for undefined / null / non-object input', () => {
    expect(parseVoicePrefs(undefined)).toEqual(DEFAULT_VOICE_PREFS);
    expect(parseVoicePrefs(null)).toEqual(DEFAULT_VOICE_PREFS);
    expect(parseVoicePrefs('nope')).toEqual(DEFAULT_VOICE_PREFS);
    expect(parseVoicePrefs(42)).toEqual(DEFAULT_VOICE_PREFS);
    expect(parseVoicePrefs([])).toEqual(DEFAULT_VOICE_PREFS);
  });

  it('reads a fully-specified valid slice', () => {
    const raw = { enabled: false, polish: false, modelTier: 'fast' };
    expect(parseVoicePrefs(raw)).toEqual({
      enabled: false,
      polish: false,
      modelTier: 'fast'
    });
  });

  it('falls back per-field for missing / wrong-typed values', () => {
    expect(parseVoicePrefs({})).toEqual(DEFAULT_VOICE_PREFS);
    expect(parseVoicePrefs({ enabled: 'yes', polish: 1 })).toEqual(DEFAULT_VOICE_PREFS);
  });

  it('defaults modelTier to "accurate" when not a valid union member', () => {
    expect(parseVoicePrefs({ modelTier: 'huge' }).modelTier).toBe('accurate');
    expect(parseVoicePrefs({ modelTier: 123 }).modelTier).toBe('accurate');
  });

  it('accepts each valid modelTier', () => {
    expect(parseVoicePrefs({ modelTier: 'fast' }).modelTier).toBe('fast');
    expect(parseVoicePrefs({ modelTier: 'accurate' }).modelTier).toBe('accurate');
  });
});

describe('VoiceStore', () => {
  it('loads via parseVoicePrefs from the voice slice', async () => {
    saveSliceMock.mockClear();
    loadSettingsMock.mockResolvedValueOnce({
      openWith: { code: 'Cursor' },
      voice: { enabled: false, polish: false, modelTier: 'fast' }
    });
    const store = new VoiceStore();
    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.prefs).toEqual({ enabled: false, polish: false, modelTier: 'fast' });
  });

  it('defaults on a fresh / empty settings blob', async () => {
    loadSettingsMock.mockResolvedValueOnce({});
    const store = new VoiceStore();
    await store.load();
    expect(store.prefs).toEqual(DEFAULT_VOICE_PREFS);
  });

  it('setEnabled updates prefs immutably and saves the voice slice', () => {
    saveSliceMock.mockClear();
    const store = new VoiceStore();
    const before = store.prefs;
    store.setEnabled(false);
    expect(store.prefs.enabled).toBe(false);
    expect(store.prefs).not.toBe(before); // immutable replacement
    expect(saveSliceMock).toHaveBeenCalledWith('voice', store.prefs);
  });

  it('setPolish updates and saves the voice slice', () => {
    saveSliceMock.mockClear();
    const store = new VoiceStore();
    store.setPolish(false);
    expect(store.prefs.polish).toBe(false);
    expect(saveSliceMock).toHaveBeenCalledWith('voice', store.prefs);
  });

  it('setModelTier updates and saves the voice slice', () => {
    saveSliceMock.mockClear();
    const store = new VoiceStore();
    store.setModelTier('fast');
    expect(store.prefs.modelTier).toBe('fast');
    expect(saveSliceMock).toHaveBeenCalledWith('voice', store.prefs);
  });

  it('save path targets the "voice" key only (does not clobber siblings)', () => {
    saveSliceMock.mockClear();
    const store = new VoiceStore();
    store.setEnabled(true);
    // Only ever writes the 'voice' slice; persist's merge preserves the rest.
    for (const call of saveSliceMock.mock.calls) {
      expect(call[0]).toBe('voice');
    }
    const saved = saveSliceMock.mock.calls.at(-1)![1] as VoicePrefs;
    expect(saved).toEqual(store.prefs);
  });
});
