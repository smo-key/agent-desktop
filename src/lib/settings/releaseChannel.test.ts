import { describe, it, expect, vi, beforeEach } from 'vitest';

// The settings blob is behind Tauri IPC; mock the shared persist helpers so the
// store's load/save can be exercised headlessly (same seam compactMode uses).
const loadSettingsMock = vi.fn(async () => ({}) as Record<string, unknown>);
const saveSettingsSliceMock = vi.fn(async (_k: string, _v: unknown) => {});
vi.mock('./persist', () => ({
  loadSettings: () => loadSettingsMock(),
  saveSettingsSlice: (k: string, v: unknown) => saveSettingsSliceMock(k, v)
}));

import {
  parseReleaseChannelPrefs,
  ReleaseChannelStore,
  DEFAULT_RELEASE_CHANNEL_PREFS,
  RELEASE_CHANNELS
} from './releaseChannel.svelte';

beforeEach(() => {
  loadSettingsMock.mockReset();
  loadSettingsMock.mockResolvedValue({});
  saveSettingsSliceMock.mockReset();
});

describe('parseReleaseChannelPrefs', () => {
  it('Fresh install defaults to stable', () => {
    expect(parseReleaseChannelPrefs(undefined)).toEqual(DEFAULT_RELEASE_CHANNEL_PREFS);
    expect(parseReleaseChannelPrefs(undefined).channel).toBe('stable');
  });

  it('Malformed slice falls back to stable', () => {
    for (const bad of [null, 0, 'beta', [], ['beta'], {}, { channel: 'nightly' }, { channel: 7 }]) {
      expect(parseReleaseChannelPrefs(bad).channel).toBe('stable');
    }
  });

  it('accepts each known channel', () => {
    for (const c of RELEASE_CHANNELS) {
      expect(parseReleaseChannelPrefs({ channel: c }).channel).toBe(c);
    }
  });
});

describe('ReleaseChannelStore', () => {
  it('Choice survives a restart', async () => {
    loadSettingsMock.mockResolvedValue({ releaseChannel: { channel: 'beta' }, compactMode: {} });
    const store = new ReleaseChannelStore();
    await store.load();
    expect(store.channel).toBe('beta');
    expect(store.loaded).toBe(true);
  });

  it('Switching channel from Settings', async () => {
    const store = new ReleaseChannelStore();
    await store.load();
    expect(store.channel).toBe('stable');

    expect(store.setChannel('beta')).toBe(true);
    expect(store.channel).toBe('beta');
    // Persisted as its own slice, so the merge in saveSettingsSlice keeps siblings.
    expect(saveSettingsSliceMock).toHaveBeenCalledWith('releaseChannel', { channel: 'beta' });
  });

  it('ignores a no-op or unknown selection', async () => {
    const store = new ReleaseChannelStore();
    await store.load();
    expect(store.setChannel('stable')).toBe(false);
    expect(store.setChannel('nightly' as never)).toBe(false);
    expect(store.channel).toBe('stable');
    expect(saveSettingsSliceMock).not.toHaveBeenCalled();
  });

  it('reads stable before load resolves', () => {
    const store = new ReleaseChannelStore();
    expect(store.channel).toBe('stable');
    expect(store.loaded).toBe(false);
  });
});
