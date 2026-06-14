import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Orchestration test for the recurring hourly poll. The Tauri IPC (check/ask/
// relaunch) is mocked, and updateStore is mocked so we can assert beginDownload
// is invoked with the found update without touching the real singleton.
const checkMock = vi.fn();
vi.mock('@tauri-apps/plugin-updater', () => ({ check: () => checkMock() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn(async () => false) }));

const beginDownloadMock = vi.fn(async (..._a: unknown[]) => {});
vi.mock('./updateStore.svelte', () => ({
  updateStore: {
    get snapshot() {
      return { status: 'idle', version: null };
    },
    beginDownload: (...a: unknown[]) => beginDownloadMock(...a)
  }
}));

import { startUpdatePolling } from './checkForUpdate';

beforeEach(() => {
  vi.useFakeTimers();
  checkMock.mockReset();
  beginDownloadMock.mockClear();
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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

  // Outside the Tauri runtime the poll is a no-op and stop() is safe.
  it('never polls outside the Tauri runtime', async () => {
    vi.stubGlobal('window', {}); // no __TAURI_INTERNALS__
    const stop = startUpdatePolling(1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(checkMock).not.toHaveBeenCalled();
    stop(); // must not throw
  });
});
