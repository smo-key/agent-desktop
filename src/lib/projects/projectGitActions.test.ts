import { describe, expect, it, vi, beforeEach } from 'vitest';

// `invoke` is mocked so the push/pull wiring can be asserted without a live Tauri
// backend. Mock pattern mirrors worktreePanel / projectGit tests.
const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => '');
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

// The toast store is mocked so we can assert the user-facing message without a
// DOM / root-mounted Toast layer.
const showMock = vi.fn((..._a: unknown[]) => 0);
vi.mock('../ui/toastStore.svelte', () => ({ toast: { show: (...a: unknown[]) => showMock(...a) } }));

import {
  pushProject,
  pullProject,
  setGitTerminalOpener,
  repoWebUrl,
  commitWebUrl
} from './projectGitActions';

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

// ── repoWebUrl ──────────────────────────────────────────────────────────────

// Scenario: repoWebUrl returns the GitHub base URL for a repo on GitHub.
it('repoWebUrl resolves the repo base URL', async () => {
  invokeMock.mockResolvedValueOnce('https://github.com/o/r');
  await expect(repoWebUrl('/repo')).resolves.toBe('https://github.com/o/r');
  expect(invokeMock).toHaveBeenCalledWith('repo_web_url', { repoPath: '/repo' });
});

// Scenario: repoWebUrl returns null when the backend can't answer (non-GitHub /
// gh missing-or-unauthenticated) — null result OR a rejected invoke, and never
// invokes for a missing path.
it('repoWebUrl returns null when unavailable', async () => {
  invokeMock.mockResolvedValueOnce(null);
  await expect(repoWebUrl('/repo')).resolves.toBeNull();

  invokeMock.mockRejectedValueOnce('gh not authenticated');
  await expect(repoWebUrl('/repo')).resolves.toBeNull();

  invokeMock.mockClear();
  await expect(repoWebUrl(null)).resolves.toBeNull();
  await expect(repoWebUrl('')).resolves.toBeNull();
  expect(invokeMock).not.toHaveBeenCalled();
});

// ── commitWebUrl ────────────────────────────────────────────────────────────

// Scenario: commitWebUrl builds the diff-view URL from base + hash.
it('commitWebUrl builds the commit diff URL', () => {
  expect(commitWebUrl('https://github.com/o/r', 'abc123')).toBe(
    'https://github.com/o/r/commit/abc123'
  );
  // A trailing slash on the base is tolerated (no `//commit`).
  expect(commitWebUrl('https://github.com/o/r/', 'abc123')).toBe(
    'https://github.com/o/r/commit/abc123'
  );
});

// Scenario: commitWebUrl yields null when base or hash is missing (non-GitHub
// repo → no link → inert row).
it('commitWebUrl is null without a base or hash', () => {
  expect(commitWebUrl(null, 'abc123')).toBeNull();
  expect(commitWebUrl('', 'abc123')).toBeNull();
  expect(commitWebUrl('https://github.com/o/r', null)).toBeNull();
  expect(commitWebUrl('https://github.com/o/r', '')).toBeNull();
});
