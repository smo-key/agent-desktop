import { describe, expect, it, vi, beforeEach } from 'vitest';

// `invoke` is mocked so branch wiring can be asserted without a live Tauri backend.
// Mirror of projectGitActions.test.ts mock setup.
const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => '');
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

// The toast store is mocked so we can assert user-facing messages without a DOM.
const showMock = vi.fn((..._a: unknown[]) => 0);
vi.mock('../ui/toastStore.svelte', () => ({ toast: { show: (...a: unknown[]) => showMock(...a) } }));

import { switchBranch, createBranch, remoteShortName, filterBranches } from './branchActions';
import { setGitTerminalOpener } from './projectGitActions';
import { gitBusy } from './projectGitBusy.svelte';

// The injected terminal opener (set by the app at startup). Reset per test.
const openMock = vi.fn((..._a: unknown[]) => {});

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue('');
  showMock.mockReset();
  openMock.mockReset();
  setGitTerminalOpener(null);
  gitBusy.byPath = {};
});

it('Successful local switch', async () => {
  const onDone = vi.fn();
  invokeMock.mockResolvedValueOnce('Switched to branch feature');
  await switchBranch('/repo', 'feature', 'Acme', 'p1', onDone);
  expect(invokeMock).toHaveBeenCalledWith('git_checkout', { repoPath: '/repo', branch: 'feature' });
  expect(showMock).toHaveBeenCalledTimes(1);
  expect(showMock.mock.calls[0][0]).toMatch(/feature/);
  expect(onDone).toHaveBeenCalledTimes(1);
});

it('Checkout blocked by uncommitted changes', async () => {
  const onDone = vi.fn();

  // (a) With NO opener wired: failure toast shown, onDone NOT called.
  invokeMock.mockRejectedValueOnce('error: Your local changes would be overwritten');
  await switchBranch('/repo', 'feature', 'Acme', 'p1', onDone);
  expect(showMock).toHaveBeenCalledTimes(1);
  expect(showMock.mock.calls[0][0]).toMatch(/error: Your local changes would be overwritten/);
  expect(onDone).not.toHaveBeenCalled();

  // Reset between sub-cases.
  invokeMock.mockReset();
  invokeMock.mockResolvedValue('');
  showMock.mockReset();
  onDone.mockReset();

  // (b) With an opener wired: openMock called with (projectId, command), no success toast.
  setGitTerminalOpener(openMock);
  invokeMock.mockRejectedValueOnce('error: Your local changes would be overwritten');
  await switchBranch('/repo', 'feature', 'Acme', 'p1', onDone);
  expect(openMock).toHaveBeenCalledWith('p1', 'git checkout feature');
  expect(showMock).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
});

it('Remote branch with no local counterpart', async () => {
  const onDone = vi.fn();
  expect(remoteShortName('origin/feature-x')).toBe('feature-x');
  const localName = remoteShortName('origin/feature-x');
  invokeMock.mockResolvedValueOnce('');
  await switchBranch('/repo', localName, 'Acme', 'p1', onDone);
  expect(invokeMock).toHaveBeenCalledWith('git_checkout', { repoPath: '/repo', branch: 'feature-x' });
});

it('Remote branch whose local branch already exists', async () => {
  expect(remoteShortName('origin/main')).toBe('main');
  expect(remoteShortName('origin/feature/x')).toBe('feature/x');

  const onDone = vi.fn();
  const localName = remoteShortName('origin/feature/x');
  invokeMock.mockResolvedValueOnce('');
  await switchBranch('/repo', localName, 'Acme', 'p1', onDone);
  expect(invokeMock).toHaveBeenCalledWith('git_checkout', { repoPath: '/repo', branch: 'feature/x' });
});

it('Create and switch to a new branch', async () => {
  const onDone = vi.fn();
  invokeMock.mockResolvedValueOnce('Switched to a new branch newbranch');
  await createBranch('/repo', 'newbranch', 'Acme', 'p1', onDone);
  expect(invokeMock).toHaveBeenCalledWith('git_create_branch', { repoPath: '/repo', name: 'newbranch' });
  expect(showMock).toHaveBeenCalledTimes(1);
  expect(showMock.mock.calls[0][0]).toMatch(/newbranch/);
  expect(onDone).toHaveBeenCalledTimes(1);
});

it('Create with an invalid or duplicate name', async () => {
  const onDone = vi.fn();
  invokeMock.mockRejectedValueOnce('fatal: a branch named newbranch already exists');
  await createBranch('/repo', 'newbranch', 'Acme', 'p1', onDone);
  expect(showMock).toHaveBeenCalledTimes(1);
  expect(showMock.mock.calls[0][0]).toMatch(/fatal: a branch named newbranch already exists/);
  expect(onDone).not.toHaveBeenCalled();
});

it('Second operation is blocked while one is running', async () => {
  // Use deferred-invoke pattern: start a switchBranch that stays in flight.
  // eslint-disable-next-line prefer-const
  let invokeResolve = null as ((v: unknown) => void) | null;
  invokeMock.mockImplementationOnce(
    (..._a: unknown[]) =>
      new Promise<unknown>((resolve) => {
        invokeResolve = resolve;
      })
  );

  const first = switchBranch('/repo', 'feature', 'Acme', 'p1');
  expect(invokeMock).toHaveBeenCalledTimes(1);
  expect(gitBusy.isBusy('/repo')).toBe(true);

  // A second switchBranch AND a createBranch for the same path must NOT call invoke again.
  await switchBranch('/repo', 'other', 'Acme', 'p1');
  await createBranch('/repo', 'newbranch', 'Acme', 'p1');
  expect(invokeMock).toHaveBeenCalledTimes(1);

  // Resolve the in-flight call; busy clears.
  invokeResolve?.('');
  await first;
  expect(gitBusy.isBusy('/repo')).toBe(false);
});

it('Filtering narrows the list', () => {
  expect(filterBranches(['main', 'feature', 'feat-x', 'dev'], 'feat')).toEqual(['feature', 'feat-x']);
  expect(filterBranches(['main', 'feature', 'feat-x', 'dev'], '')).toEqual(['main', 'feature', 'feat-x', 'dev']);
  expect(filterBranches(['main', 'feature'], '   ')).toEqual(['main', 'feature']);
});
