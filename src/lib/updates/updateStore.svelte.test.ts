import { describe, it, expect, vi, beforeEach } from 'vitest';

// The store's only Tauri IPC is `relaunch()` (process plugin); mock it so the
// install→relaunch path is exercisable headlessly. `update.download()` /
// `update.install()` / `update.close()` live on the passed `Update` handle, which
// we fake directly. Named `*.svelte.test.ts` so vitest compiles the `$state` runes.
const relaunchMock = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: (...a: unknown[]) => relaunchMock(...a)
}));

import { UpdateStore } from './updateStore.svelte';

// Build a fake `Update` handle with controllable download() + spy install()/close().
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
  const close = vi.fn(async () => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update = { version, download, install, close } as any;
  // resolve/reject are assigned only when download() runs (inside beginDownload),
  // so expose them via thunks that read the live closure refs — not by value.
  return {
    update,
    download,
    install,
    close,
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
    expect(f.close).not.toHaveBeenCalled(); // staged handle is kept, not closed
  });

  it('beginDownload resets to idle AND closes the handle when the download fails', async () => {
    const s = new UpdateStore();
    const f = fakeUpdate('1.2.3');
    const p = s.beginDownload(f.update);
    f.rejectDownload(new Error('offline'));
    await p;
    expect(s.status).toBe('idle');
    expect(s.version).toBeNull();
    expect(f.close).toHaveBeenCalledOnce(); // failed handle released (no leak)
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

  // WARNING regression: a failed relaunch must restore the pill (status → ready)
  // so the user can retry, not get stuck in a hidden 'installing' state.
  it('restartToUpdate restores ready when relaunch rejects', async () => {
    relaunchMock.mockRejectedValueOnce(new Error('relaunch denied'));
    const s = new UpdateStore();
    const f = fakeUpdate('1.2.3');
    const p = s.beginDownload(f.update);
    f.resolveDownload();
    await p;
    await s.restartToUpdate(); // does not throw (caught internally)
    expect(f.install).toHaveBeenCalledOnce();
    expect(s.status).toBe('ready'); // pill comes back for a retry
  });

  // CRITICAL 3 regression: a double-click must not double-install / double-relaunch.
  it('restartToUpdate ignores a concurrent second click (installs once)', async () => {
    const s = new UpdateStore();
    const f = fakeUpdate('1.2.3');
    const p = s.beginDownload(f.update);
    f.resolveDownload();
    await p;
    // Two clicks before the first settles — the status flips to 'installing'
    // synchronously, so the second must short-circuit.
    const a = s.restartToUpdate();
    const b = s.restartToUpdate();
    await Promise.all([a, b]);
    expect(s.status).toBe('installing');
    expect(f.install).toHaveBeenCalledOnce();
    expect(relaunchMock).toHaveBeenCalledOnce();
  });

  // CRITICAL 1 + 2 regression: a newer version that supersedes an in-flight one
  // must (a) leave version === the staged handle, and (b) close the stale handle.
  it('supersede keeps version/staged consistent and closes the stale handle', async () => {
    const s = new UpdateStore();
    const older = fakeUpdate('2.0.0');
    const newer = fakeUpdate('2.1.0');
    const pOld = s.beginDownload(older.update); // in-flight (download pending)
    const pNew = s.beginDownload(newer.update); // supersedes while older downloads
    expect(s.status).toBe('downloading');
    expect(s.version).toBe('2.1.0');
    // The OLDER download finishes first — but it's stale, so it must NOT commit.
    older.resolveDownload();
    await pOld;
    expect(s.version).toBe('2.1.0'); // not regressed to the older version
    expect(older.close).toHaveBeenCalledOnce(); // stale handle released
    // The newer download finishes and commits.
    newer.resolveDownload();
    await pNew;
    expect(s.status).toBe('ready');
    expect(s.version).toBe('2.1.0');
    // restartToUpdate must install the NEWER handle (matches the advertised version).
    await s.restartToUpdate();
    expect(newer.install).toHaveBeenCalledOnce();
    expect(older.install).not.toHaveBeenCalled();
  });

  // seq-guard regression: a stale (superseded) download that REJECTS after the
  // newer one already committed must NOT reset the newer 'ready' state.
  it('a stale download rejecting after supersede does not clobber the newer ready', async () => {
    const s = new UpdateStore();
    const older = fakeUpdate('2.0.0');
    const newer = fakeUpdate('2.1.0');
    const pOld = s.beginDownload(older.update);
    const pNew = s.beginDownload(newer.update);
    // Newer commits first.
    newer.resolveDownload();
    await pNew;
    expect(s.status).toBe('ready');
    expect(s.version).toBe('2.1.0');
    // Older now FAILS — its catch must see seq !== mine and leave ready intact.
    older.rejectDownload(new Error('stale/offline'));
    await pOld;
    expect(s.status).toBe('ready');
    expect(s.version).toBe('2.1.0');
    expect(older.close).toHaveBeenCalledOnce(); // stale handle still released
  });

  // CRITICAL 2 regression: a duplicate handle for the already-staged version is
  // closed and does NOT start a second download.
  it('ignores + closes a duplicate handle for the already-staged version', async () => {
    const s = new UpdateStore();
    const first = fakeUpdate('3.0.0');
    const p = s.beginDownload(first.update);
    first.resolveDownload();
    await p;
    expect(s.status).toBe('ready');
    const dup = fakeUpdate('3.0.0'); // same version, fresh handle (e.g. hourly poll)
    await s.beginDownload(dup.update);
    expect(dup.download).not.toHaveBeenCalled(); // no second download
    expect(dup.close).toHaveBeenCalledOnce(); // redundant handle released
    expect(s.status).toBe('ready'); // original staging intact
  });

  // While installing, a poll that finds an update must not disturb the staged
  // handle — the fresh handle is closed and no download starts.
  it('beginDownload is a no-op (closes handle) while installing', async () => {
    const s = new UpdateStore();
    const f = fakeUpdate('4.0.0');
    const p = s.beginDownload(f.update);
    f.resolveDownload();
    await p;
    await s.restartToUpdate(); // status → 'installing'
    expect(s.status).toBe('installing');
    const next = fakeUpdate('4.1.0');
    await s.beginDownload(next.update);
    expect(next.download).not.toHaveBeenCalled();
    expect(next.close).toHaveBeenCalledOnce();
  });
});
