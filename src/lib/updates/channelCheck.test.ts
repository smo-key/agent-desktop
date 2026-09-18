import { describe, it, expect, vi, beforeEach } from 'vitest';

// `checkOnChannel` is a thin seam over the Rust `updater_check` command: it passes
// the channel through and rebuilds a plugin `Update` from the returned metadata.
// Both halves are worth guarding — the channel argument is what makes the whole
// feature work, and `null` (no candidate) must NOT become an `Update`.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

// The real `Update` extends Resource and talks to the plugin; a recording
// stand-in lets us assert the metadata is handed over verbatim. Declared INSIDE
// the factory — a class binding in the module body would be in its TDZ when the
// hoisted factory runs.
vi.mock('@tauri-apps/plugin-updater', () => ({
  Update: class {
    meta: Record<string, unknown>;
    constructor(meta: Record<string, unknown>) {
      this.meta = meta;
    }
  }
}));

import { checkOnChannel } from './channelCheck';

const META = {
  rid: 7,
  currentVersion: '0.3.2',
  version: '0.4.0-beta.1',
  rawJson: { version: '0.4.0-beta.1' }
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe('checkOnChannel', () => {
  it('Check uses the selected channel endpoint', async () => {
    invokeMock.mockResolvedValue(META);
    await checkOnChannel('beta');
    expect(invokeMock).toHaveBeenCalledWith('updater_check', { channel: 'beta' });

    invokeMock.mockResolvedValue(null);
    await checkOnChannel('stable');
    expect(invokeMock).toHaveBeenLastCalledWith('updater_check', { channel: 'stable' });
  });

  it('rebuilds an Update from the returned metadata', async () => {
    invokeMock.mockResolvedValue(META);
    const update = await checkOnChannel('beta');
    // The rid is what the plugin's own download/install commands resolve, so it
    // must survive the round trip untouched.
    expect(update).not.toBeNull();
    expect((update as unknown as { meta: unknown }).meta).toEqual(META);
  });

  it('resolves null when the channel has nothing newer', async () => {
    invokeMock.mockResolvedValue(null);
    expect(await checkOnChannel('stable')).toBeNull();
  });

  it('propagates a check failure to the caller', async () => {
    invokeMock.mockRejectedValue(new Error('offline'));
    await expect(checkOnChannel('beta')).rejects.toThrow('offline');
  });
});
