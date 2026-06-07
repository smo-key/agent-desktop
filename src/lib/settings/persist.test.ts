import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tests for the shared settings persistence helpers. These guarantee that
// independent settings slices (openWith, voice, …) coexist in a single
// `settings.json` blob without clobbering each other: load returns `{}` when
// nothing is persisted (or the blob is corrupt), and saveSettingsSlice does a
// read-modify-write merge that preserves sibling keys. The Tauri `invoke` is
// mocked — these assert the merge logic, not real I/O.

const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { loadSettings, saveSettingsSlice } from './persist';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
});

describe('loadSettings', () => {
  it('returns {} when nothing is persisted (null)', async () => {
    invokeMock.mockResolvedValueOnce(null);
    expect(await loadSettings()).toEqual({});
  });

  it('returns {} on a corrupt / non-JSON blob', async () => {
    invokeMock.mockResolvedValueOnce('not json');
    expect(await loadSettings()).toEqual({});
  });

  it('returns {} when the invoke throws (non-Tauri env)', async () => {
    invokeMock.mockRejectedValueOnce(new Error('no tauri'));
    expect(await loadSettings()).toEqual({});
  });

  it('parses and returns the persisted settings object', async () => {
    invokeMock.mockResolvedValueOnce(JSON.stringify({ openWith: { code: 'Cursor' } }));
    expect(await loadSettings()).toEqual({ openWith: { code: 'Cursor' } });
  });

  it('returns {} when the blob is a JSON non-object (array / scalar)', async () => {
    invokeMock.mockResolvedValueOnce('[1,2,3]');
    expect(await loadSettings()).toEqual({});
  });
});

describe('saveSettingsSlice', () => {
  it('merges a new slice without clobbering an existing one', async () => {
    // settings.json already holds an openWith slice.
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({ openWith: { code: 'Cursor' } })
    ); // settings_load
    invokeMock.mockResolvedValueOnce(undefined); // settings_save

    await saveSettingsSlice('voice', { enabled: true });

    // The save call must contain BOTH slices.
    const saveCall = invokeMock.mock.calls.find((c) => c[0] === 'settings_save');
    expect(saveCall).toBeDefined();
    const saved = JSON.parse((saveCall![1] as { json: string }).json);
    expect(saved).toEqual({
      openWith: { code: 'Cursor' },
      voice: { enabled: true }
    });
  });

  it('overwrites only the named slice on re-save', async () => {
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({ openWith: { code: 'Cursor' }, voice: { enabled: true } })
    );
    invokeMock.mockResolvedValueOnce(undefined);

    await saveSettingsSlice('voice', { enabled: false });

    const saveCall = invokeMock.mock.calls.find((c) => c[0] === 'settings_save');
    const saved = JSON.parse((saveCall![1] as { json: string }).json);
    expect(saved).toEqual({
      openWith: { code: 'Cursor' },
      voice: { enabled: false }
    });
  });

  it('writes the slice into a fresh {} when nothing was persisted', async () => {
    invokeMock.mockResolvedValueOnce(null); // settings_load → fresh
    invokeMock.mockResolvedValueOnce(undefined); // settings_save

    await saveSettingsSlice('voice', { enabled: true });

    const saveCall = invokeMock.mock.calls.find((c) => c[0] === 'settings_save');
    const saved = JSON.parse((saveCall![1] as { json: string }).json);
    expect(saved).toEqual({ voice: { enabled: true } });
  });
});
