import { describe, expect, it, vi, beforeEach } from 'vitest';

// `invoke` is mocked so the push/pull wiring can be asserted without a live Tauri
// backend. Mock pattern mirrors worktreePanel / projectGit tests.
const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => '');
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

// The toast store is mocked so we can assert the user-facing message without a
// DOM / root-mounted Toast layer.
const showMock = vi.fn((..._a: unknown[]) => 0);
vi.mock('../ui/toastStore.svelte', () => ({ toast: { show: (...a: unknown[]) => showMock(...a) } }));

import { pushProject, pullProject, setGitTerminalOpener } from './projectGitActions';

// The injected terminal opener (set by the app at startup). Reset per test.
const openMock = vi.fn((..._a: unknown[]) => {});

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue('');
  showMock.mockReset();
  openMock.mockReset();
  setGitTerminalOpener(null);
});

// Scenario: Push succeeds
it('Push succeeds', async () => {
  invokeMock.mockResolvedValueOnce('Everything up-to-date');
  await pushProject('/repo', 'Acme');
  // Runs git push in the project's folder…
  expect(invokeMock).toHaveBeenCalledWith('git_push', { repoPath: '/repo' });
  // …and shows a success toast naming the project and echoing git's message.
  expect(showMock).toHaveBeenCalledTimes(1);
  expect(showMock.mock.calls[0][0]).toMatch(/Acme/);
  expect(showMock.mock.calls[0][0]).toMatch(/Everything up-to-date/);
});

// Scenario: Pull succeeds
it('Pull succeeds', async () => {
  invokeMock.mockResolvedValueOnce('Fast-forward');
  await pullProject('/repo', 'Acme');
  expect(invokeMock).toHaveBeenCalledWith('git_pull', { repoPath: '/repo' });
  expect(showMock).toHaveBeenCalledTimes(1);
  expect(showMock.mock.calls[0][0]).toMatch(/Acme/);
});

// Scenario: Push or pull failure opens a terminal — when a terminal surface is
// wired, a failed sync opens an interactive terminal in the project's folder
// running the failed git command (no toast). Holds for BOTH push and pull.
it('Push or pull failure opens a terminal', async () => {
  setGitTerminalOpener(openMock);

  invokeMock.mockRejectedValueOnce('rejected: no upstream');
  await pushProject('/repo', 'Acme', 'p1');
  expect(openMock).toHaveBeenCalledWith('p1', 'git push');
  expect(showMock).not.toHaveBeenCalled();

  openMock.mockClear();
  invokeMock.mockRejectedValueOnce('conflict in foo.txt');
  await pullProject('/repo', 'Acme', 'p1');
  expect(openMock).toHaveBeenCalledWith('p1', 'git pull');
  expect(showMock).not.toHaveBeenCalled();
});

// Scenario: Push or pull fails — with no opener wired (or no project id), git's
// error rides a failure toast and the action never throws, for BOTH push and pull.
it('Push or pull fails', async () => {
  invokeMock.mockRejectedValueOnce('rejected: no upstream');
  await expect(pushProject('/repo', 'Acme', 'p1')).resolves.toBeUndefined();
  expect(showMock.mock.calls[0][0]).toMatch(/rejected: no upstream/);

  showMock.mockClear();
  invokeMock.mockRejectedValueOnce('conflict in foo.txt');
  await expect(pullProject('/repo', 'Acme', 'p1')).resolves.toBeUndefined();
  expect(showMock.mock.calls[0][0]).toMatch(/conflict in foo.txt/);
});

// Scenario: Project has no folder — warn, never invoke git.
it('Project has no folder', async () => {
  await pushProject('', 'Acme');
  await pullProject(null, 'Acme');
  expect(invokeMock).not.toHaveBeenCalled();
  expect(showMock).toHaveBeenCalledTimes(2);
  expect(showMock.mock.calls[0][0]).toMatch(/no folder/i);
});
