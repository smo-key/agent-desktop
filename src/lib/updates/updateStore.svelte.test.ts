import { describe, it, expect, vi, beforeEach } from 'vitest';

// The store's only Tauri IPC is `relaunch()` (process plugin); mock it so the
// install→relaunch path is exercisable headlessly. `update.download()` /
// `update.install()` live on the passed `Update` handle, which we fake directly.
// Named `*.svelte.test.ts` so vitest compiles the `$state` runes.
const relaunchMock = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: (...a: unknown[]) => relaunchMock(...a)
}));

import { UpdateStore } from './updateStore.svelte';

// Build a fake `Update` handle with controllable download() + a spy install().
function fakeUpdate(version: string) {
  let resolveDownload!: () => void;
  let rejectDownload!: (e: unknown) => void;
  const download = vi.fn(
    () =>
      new Promise<void>((res, rej) => {
        resolveDownload = res;
        rejectDownload = rej;
      })
  );
  const install = vi.fn(async () => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update = { version, download, install } as any;
  // resolve/reject are assigned only when download() runs (inside beginDownload),
  // so expose them via thunks that read the live closure refs — not by value.
  return {
    update,
    download,
    install,
    resolveDownload: () => resolveDownload(),
    rejectDownload: (e: unknown) => rejectDownload(e)
  };
}

beforeEach(() => {
  relaunchMock.mockClear();
});

describe('UpdateStore', () => {
  it('starts idle with no version', () => {
    const s = new UpdateStore();
    expect(s.status).toBe('idle');
    expect(s.version).toBeNull();
    expect(s.snapshot).toEqual({ status: 'idle', version: null });
  });

  it('beginDownload goes downloading → ready and stamps the version', async () => {
    const s = new UpdateStore();
    const f = fakeUpdate('1.2.3');
    const p = s.beginDownload(f.update);
    // Synchronously after the call we are downloading the known version.
    expect(s.status).toBe('downloading');
    expect(s.version).toBe('1.2.3');
    f.resolveDownload();
    await p;
    expect(s.status).toBe('ready');
    expect(s.version).toBe('1.2.3');
    expect(f.download).toHaveBeenCalledOnce();
  });

  it('beginDownload resets to idle when the download fails (silent)', async () => {
    const s = new UpdateStore();
    const f = fakeUpdate('1.2.3');
    const p = s.beginDownload(f.update);
    f.rejectDownload(new Error('offline'));
    await p;
    expect(s.status).toBe('idle');
    expect(s.version).toBeNull();
  });

  it('restartToUpdate installs the staged update then relaunches', async () => {
    const s = new UpdateStore();
    const f = fakeUpdate('1.2.3');
    const p = s.beginDownload(f.update);
    f.resolveDownload();
    await p;
    await s.restartToUpdate();
    expect(f.install).toHaveBeenCalledOnce();
    expect(relaunchMock).toHaveBeenCalledOnce();
    // install must precede relaunch.
    expect(f.install.mock.invocationCallOrder[0]).toBeLessThan(
      relaunchMock.mock.invocationCallOrder[0]
    );
  });

  it('restartToUpdate is a no-op when nothing is staged', async () => {
    const s = new UpdateStore();
    await s.restartToUpdate();
    expect(relaunchMock).not.toHaveBeenCalled();
  });
});
