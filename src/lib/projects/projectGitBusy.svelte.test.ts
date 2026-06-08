import { describe, expect, it, vi, beforeEach } from 'vitest';

// `invoke` is deferred so we can hold a push/pull "in flight" and assert the guard.
let invokeResolve: ((v: unknown) => void) | null = null;
const invokeMock = vi.fn(
  (..._a: unknown[]) =>
    new Promise<unknown>((resolve) => {
      invokeResolve = resolve;
    })
);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

const showMock = vi.fn((..._a: unknown[]) => 0);
vi.mock('../ui/toastStore.svelte', () => ({ toast: { show: (...a: unknown[]) => showMock(...a) } }));

import { pushProject, pullProject } from './projectGitActions';
import { gitBusy, GitBusyStore } from './projectGitBusy.svelte';

beforeEach(() => {
  invokeMock.mockClear();
  invokeResolve = null;
  showMock.mockReset();
  gitBusy.byPath = {};
});

describe('GitBusyStore', () => {
  it('tracks begin / isBusy / end by path', () => {
    const s = new GitBusyStore();
    expect(s.isBusy('/repo')).toBe(false);
    s.begin('/repo');
    expect(s.isBusy('/repo')).toBe(true);
    expect(s.isBusy('/other')).toBe(false);
    s.end('/repo');
    expect(s.isBusy('/repo')).toBe(false);
  });

  it('isBusy is false for null/empty path', () => {
    const s = new GitBusyStore();
    expect(s.isBusy(null)).toBe(false);
    expect(s.isBusy(undefined)).toBe(false);
    expect(s.isBusy('')).toBe(false);
  });
});

describe('push/pull in-progress guard', () => {
  it('Push and pull are blocked while a sync is in progress', async () => {
    // First push starts and stays in flight (invoke is deferred).
    const first = pushProject('/repo', 'Acme');
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(gitBusy.isBusy('/repo')).toBe(true);

    // A second push AND a pull for the same folder no-op while busy — no new invoke.
    await pushProject('/repo', 'Acme');
    await pullProject('/repo', 'Acme');
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // Resolve the in-flight push; the folder is no longer busy afterwards.
    invokeResolve?.('Everything up-to-date');
    await first;
    expect(gitBusy.isBusy('/repo')).toBe(false);

    // Once clear, a new push runs again.
    void pushProject('/repo', 'Acme');
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('a different project is not blocked by another folders sync', async () => {
    void pushProject('/repo-a', 'A');
    void pushProject('/repo-b', 'B');
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(gitBusy.isBusy('/repo-a')).toBe(true);
    expect(gitBusy.isBusy('/repo-b')).toBe(true);
  });
});
