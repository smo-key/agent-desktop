import { describe, expect, it, vi, beforeEach } from 'vitest';

// `invoke` is mocked so the push/pull wiring can be asserted without a live Tauri
// backend. Mock pattern mirrors worktreePanel / projectGit tests.
const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => '');
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

// The toast store is mocked so we can assert the user-facing message without a
// DOM / root-mounted Toast layer.
const showMock = vi.fn((..._a: unknown[]) => 0);
vi.mock('../ui/toastStore.svelte', () => ({ toast: { show: (...a: unknown[]) => showMock(...a) } }));

import { pushProject, pullProject } from './projectGitActions';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue('');
  showMock.mockReset();
});

describe('pushProject', () => {
  it('invokes git_push with the project path', async () => {
    await pushProject('/repo', 'Acme');
    expect(invokeMock).toHaveBeenCalledWith('git_push', { repoPath: '/repo' });
  });

  it('toasts a success message naming the project', async () => {
    invokeMock.mockResolvedValueOnce('Everything up-to-date');
    await pushProject('/repo', 'Acme');
    expect(showMock).toHaveBeenCalledTimes(1);
    expect(showMock.mock.calls[0][0]).toMatch(/Acme/);
    expect(showMock.mock.calls[0][0]).toMatch(/[Pp]ush/);
  });

  it('toasts the git error message when the push fails', async () => {
    invokeMock.mockRejectedValueOnce('rejected: no upstream');
    await pushProject('/repo', 'Acme');
    expect(showMock).toHaveBeenCalledTimes(1);
    expect(showMock.mock.calls[0][0]).toMatch(/rejected: no upstream/);
  });

  it('does nothing for a project with no path', async () => {
    await pushProject('', 'Acme');
    expect(invokeMock).not.toHaveBeenCalled();
    expect(showMock).toHaveBeenCalledTimes(1); // warns that there's no folder
  });
});

describe('pullProject', () => {
  it('invokes git_pull with the project path', async () => {
    await pullProject('/repo', 'Acme');
    expect(invokeMock).toHaveBeenCalledWith('git_pull', { repoPath: '/repo' });
  });

  it('toasts the git error message when the pull fails', async () => {
    invokeMock.mockRejectedValueOnce('conflict in foo.txt');
    await pullProject('/repo', 'Acme');
    expect(showMock.mock.calls[0][0]).toMatch(/conflict in foo.txt/);
  });
});
