import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Orchestration tests for the launch check, the recurring hourly poll, and the
// shared `runUpdateCheck`. The Tauri IPC (check/relaunch) is mocked, and
// updateStore is mocked so we can assert beginDownload is invoked with the found
// update without touching the real singleton. There is no dialog any more — both
// launch and poll stage in the background, so nothing here mocks plugin-dialog.
const checkMock = vi.fn();
vi.mock('@tauri-apps/plugin-updater', () => ({ check: () => checkMock() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(async () => {}) }));

const beginDownloadMock = vi.fn(async (..._a: unknown[]) => {});
// Mutable snapshot so a test can simulate "this version is already staged".
// Referenced LAZILY inside the factory's getter so the hoisted vi.mock doesn't hit
// a TDZ on these module-scope bindings.
let snapshot: { status: string; version: string | null } = { status: 'idle', version: null };
vi.mock('./updateStore.svelte', () => ({
  updateStore: {
    get snapshot() {
      return snapshot;
    },
    beginDownload: (...a: unknown[]) => beginDownloadMock(...a),
    // Settable seam: checkForUpdate wires this to runUpdateCheck for the retry pill.
    recheck: null as null | (() => Promise<unknown>)
  }
}));

import { startUpdatePolling, checkForUpdateOnLaunch, runUpdateCheck } from './checkForUpdate';
import { updateStore } from './updateStore.svelte'; // resolves to the mock above

beforeEach(() => {
  vi.useFakeTimers();
  checkMock.mockReset();
  beginDownloadMock.mockClear();
  snapshot = { status: 'idle', version: null };
  updateStore.recheck = null;
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('checkForUpdateOnLaunch', () => {
  // Scenario: Launch check stages in the background (no dialog/prompt).
  it('downloads a found update on launch without prompting', async () => {
    checkMock.mockResolvedValue({ version: '2.0.0' });
    await checkForUpdateOnLaunch();
    expect(beginDownloadMock).toHaveBeenCalledWith({ version: '2.0.0' });
  });

  // Scenario: No update or check fails on launch — continue silently.
  it('does nothing when there is no update', async () => {
    checkMock.mockResolvedValue(null);
    await checkForUpdateOnLaunch();
    expect(beginDownloadMock).not.toHaveBeenCalled();
  });

  it('swallows a launch check that throws (offline)', async () => {
    checkMock.mockRejectedValue(new Error('offline'));
    await checkForUpdateOnLaunch();
    expect(beginDownloadMock).not.toHaveBeenCalled();
  });

  // The launch check wires the store's retry seam to a fresh check cycle.
  it('registers the recheck seam for the retry pill', async () => {
    checkMock.mockResolvedValue(null);
    await checkForUpdateOnLaunch();
    expect(updateStore.recheck).toBe(runUpdateCheck);
  });
});

describe('runUpdateCheck', () => {
  it("returns 'started' and downloads when an update is found", async () => {
    checkMock.mockResolvedValue({ version: '2.0.0' });
    expect(await runUpdateCheck()).toBe('started');
    expect(beginDownloadMock).toHaveBeenCalledWith({ version: '2.0.0' });
  });

  it("returns 'up-to-date' when no newer version exists", async () => {
    checkMock.mockResolvedValue(null);
    expect(await runUpdateCheck()).toBe('up-to-date');
    expect(beginDownloadMock).not.toHaveBeenCalled();
  });

  it("returns 'error' when the check throws", async () => {
    checkMock.mockRejectedValue(new Error('offline'));
    expect(await runUpdateCheck()).toBe('error');
  });

  it("returns 'noop' and closes the handle when the version is already staged", async () => {
    snapshot = { status: 'ready', version: '2.0.0' };
    const close = vi.fn(async () => {});
    checkMock.mockResolvedValue({ version: '2.0.0', close });
    expect(await runUpdateCheck()).toBe('noop');
    expect(beginDownloadMock).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns 'unavailable' outside the Tauri runtime", async () => {
    vi.stubGlobal('window', {});
    expect(await runUpdateCheck()).toBe('unavailable');
    expect(checkMock).not.toHaveBeenCalled();
  });
});

describe('startUpdatePolling', () => {
  // Scenario: Recurring check finds and stages an update.
  it('downloads a found update on each interval and never at t=0', async () => {
    checkMock.mockResolvedValue({ version: '2.0.0' });
    const stop = startUpdatePolling(1000);
    expect(checkMock).not.toHaveBeenCalled(); // launch check covers t=0, not the poll
    await vi.advanceTimersByTimeAsync(1000);
    expect(checkMock).toHaveBeenCalledOnce();
    expect(beginDownloadMock).toHaveBeenCalledWith({ version: '2.0.0' });
    stop();
  });

  // Scenario: the returned stop() halts further polling.
  it('stop() clears the interval', async () => {
    checkMock.mockResolvedValue(null);
    const stop = startUpdatePolling(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(checkMock).toHaveBeenCalledOnce();
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(checkMock).toHaveBeenCalledOnce(); // no further checks after stop
  });

  // Scenario: Background check or download failure is silent (no update → no download).
  it('does not download when no update is available', async () => {
    checkMock.mockResolvedValue(null);
    const stop = startUpdatePolling(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(beginDownloadMock).not.toHaveBeenCalled();
    stop();
  });

  it('swallows a check that throws (offline) without downloading', async () => {
    checkMock.mockRejectedValue(new Error('offline'));
    const stop = startUpdatePolling(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(beginDownloadMock).not.toHaveBeenCalled();
    stop();
  });

  // CRITICAL 2 regression: an hourly re-check of an already-staged version must
  // CLOSE the freshly-obtained handle (no per-hour resource leak) and not
  // re-download.
  it('closes the handle (no download) when the found version is already staged', async () => {
    snapshot = { status: 'ready', version: '2.0.0' };
    const close = vi.fn(async () => {});
    checkMock.mockResolvedValue({ version: '2.0.0', close });
    const stop = startUpdatePolling(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(beginDownloadMock).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    stop();
  });

  // Outside the Tauri runtime the poll is a no-op and stop() is safe.
  it('never polls outside the Tauri runtime', async () => {
    vi.stubGlobal('window', {}); // no __TAURI_INTERNALS__
    const stop = startUpdatePolling(1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(checkMock).not.toHaveBeenCalled();
    stop(); // must not throw
  });
});
