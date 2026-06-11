import { describe, expect, it, vi, beforeEach } from 'vitest';

// `invoke` is mocked so the PR-status wiring can be asserted without a live Tauri
// backend. Mock pattern mirrors projectGitActions / projectGit tests.
const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ kind: 'unknown' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

// The confirm modal store is mocked so we can assert the show()/onConfirm wiring
// without a DOM-mounted modal. `show` records the options; `fireConfirm` invokes
// the stored onConfirm (what the danger button does).
let lastShow: { title: string; message: string; confirmLabel?: string; onConfirm: () => void } | null =
  null;
const showMock = vi.fn((opts: typeof lastShow) => {
  lastShow = opts;
});
vi.mock('../ui/confirmStore.svelte', () => ({
  confirmModal: { show: (o: unknown) => showMock(o as typeof lastShow) }
}));

import {
  DEFAULT_BASE,
  prButtonDisabled,
  prStatusFor,
  setAgentTaskLauncher,
  buildCreatePrPrompt,
  buildCommitPrompt,
  onCommitButtonClick,
  onPrButtonClick,
  prCache,
  type PrStatus
} from './prActions';

// The injected agent-task launcher (set by the app at startup). Reset per test.
const launchMock = vi.fn((..._a: unknown[]) => {});

// A spy for external-open. We don't assert on the real opener here; tests that
// need to assert open route through `invoke('open_path', …)`.
beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ kind: 'unknown' });
  showMock.mockReset();
  launchMock.mockReset();
  lastShow = null;
  prCache.clear();
  setAgentTaskLauncher(null);
});

// ─────────────────────────── disabled logic ───────────────────────────

describe('prButtonDisabled', () => {
  // Scenario: disabled when there is no project.
  it('is disabled with no project id', () => {
    expect(prButtonDisabled(null, 'feature', DEFAULT_BASE)).toBe(true);
  });

  // Scenario: disabled when there is no branch.
  it('is disabled with no branch', () => {
    expect(prButtonDisabled('p1', null, DEFAULT_BASE)).toBe(true);
    expect(prButtonDisabled('p1', '', DEFAULT_BASE)).toBe(true);
  });

  // Scenario: disabled when the current branch IS the base.
  it('is disabled when on the base branch', () => {
    expect(prButtonDisabled('p1', 'main', 'main')).toBe(true);
  });

  // Scenario: enabled on a feature branch with a project.
  it('is enabled on a feature branch', () => {
    expect(prButtonDisabled('p1', 'feature-x', DEFAULT_BASE)).toBe(false);
  });
});

// ─────────────────────────── status fetch + cache ───────────────────────────

describe('prStatusFor', () => {
  it('invokes pr_status_for and caches the result per branch', async () => {
    invokeMock.mockResolvedValueOnce({ kind: 'exists', url: 'u', number: 1 });
    const s = await prStatusFor('/repo', 'feature', 'main');
    expect(invokeMock).toHaveBeenCalledWith('pr_status_for', { repoPath: '/repo', base: 'main' });
    expect(s).toEqual({ kind: 'exists', url: 'u', number: 1 });
    // Cached under the branch key.
    expect(prCache.get('feature')).toEqual({ kind: 'exists', url: 'u', number: 1 });
  });

  it('degrades to unknown when the command throws', async () => {
    invokeMock.mockRejectedValueOnce('gh missing');
    const s = await prStatusFor('/repo', 'feature', 'main');
    expect(s).toEqual({ kind: 'unknown' });
  });
});

// ─────────────────────────── create-PR prompt ───────────────────────────

describe('buildCreatePrPrompt', () => {
  it('names the base branch and instructs a PR creation', () => {
    const p = buildCreatePrPrompt('main');
    expect(p).toMatch(/main/);
    expect(p.toLowerCase()).toMatch(/pull request|pr/);
  });
});

// ─────────────────────────── open-vs-create decision ───────────────────────────

describe('onPrButtonClick', () => {
  const proj = { id: 'p1', path: '/repo', name: 'Acme' };

  // Scenario: a PR exists → open it on GitHub, no confirm.
  it('opens an existing PR externally and never confirms', async () => {
    const status: PrStatus = { kind: 'exists', url: 'https://github.com/o/r/pull/9', number: 9 };
    await onPrButtonClick(proj, 'feature', 'main', status);
    expect(invokeMock).toHaveBeenCalledWith('open_path', {
      path: 'https://github.com/o/r/pull/9',
      app: null
    });
    expect(showMock).not.toHaveBeenCalled();
    expect(launchMock).not.toHaveBeenCalled();
  });

  // Scenario: no PR → confirm; confirming spawns the agent task with the prompt.
  it('confirms then spawns the launcher on confirm when no PR exists', async () => {
    setAgentTaskLauncher(launchMock);
    const status: PrStatus = { kind: 'none' };
    await onPrButtonClick(proj, 'feature', 'main', status);
    // The confirm modal is shown with a Create PR label…
    expect(showMock).toHaveBeenCalledTimes(1);
    expect(lastShow?.confirmLabel).toBe('Create PR');
    // …and nothing has launched yet (the user hasn't confirmed).
    expect(launchMock).not.toHaveBeenCalled();
    // Fire the confirm callback → launches the agent task with project id + prompt.
    lastShow?.onConfirm();
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(launchMock.mock.calls[0][0]).toBe('p1');
    expect(launchMock.mock.calls[0][1]).toMatch(/main/);
  });

  // Scenario: PR status UNKNOWN → fall back to the create-confirm path (NOT nothing).
  it('falls back to confirm when status is unknown', async () => {
    setAgentTaskLauncher(launchMock);
    const status: PrStatus = { kind: 'unknown' };
    await onPrButtonClick(proj, 'feature', 'main', status);
    expect(showMock).toHaveBeenCalledTimes(1);
    // open_path is never called for unknown (we don't have a URL to open).
    expect(invokeMock).not.toHaveBeenCalledWith('open_path', expect.anything());
  });

  // Scenario: cancel fires nothing — the launcher is not invoked.
  it('does not launch when the confirm is cancelled', async () => {
    setAgentTaskLauncher(launchMock);
    await onPrButtonClick(proj, 'feature', 'main', { kind: 'none' });
    // Simulate cancel: onConfirm is simply never called.
    expect(launchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── commit prompt ───────────────────────────

describe('buildCommitPrompt', () => {
  it('instructs staging + a single conventional commit on the current branch, no push/PR', () => {
    const p = buildCommitPrompt().toLowerCase();
    expect(p).toMatch(/commit/);
    expect(p).toMatch(/current branch/);
    // One commit with a conventional message.
    expect(p).toMatch(/conventional/);
    // Explicitly NOT push and NOT a PR.
    expect(p).toMatch(/do not push|don't push|not push/);
    expect(p).toMatch(/pull request|\bpr\b/);
  });
});

// ─────────────────────────── commit-button click ───────────────────────────

describe('onCommitButtonClick', () => {
  const proj = { id: 'p1', path: '/repo', name: 'Acme' };

  // Scenario: clicking with changes opens a confirm dialog (Commit label).
  it('shows a confirm dialog with a Commit label', () => {
    setAgentTaskLauncher(launchMock);
    onCommitButtonClick(proj);
    expect(showMock).toHaveBeenCalledTimes(1);
    expect(lastShow?.confirmLabel).toBe('Commit');
    // Nothing launches until the user confirms.
    expect(launchMock).not.toHaveBeenCalled();
  });

  // Scenario: confirming spawns the agent task with the project id + commit prompt.
  it('spawns the launcher with the project id and commit prompt on confirm', () => {
    setAgentTaskLauncher(launchMock);
    onCommitButtonClick(proj);
    lastShow?.onConfirm();
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(launchMock.mock.calls[0][0]).toBe('p1');
    expect(String(launchMock.mock.calls[0][1]).toLowerCase()).toMatch(/commit/);
  });

  // Scenario: cancel fires nothing — the launcher is not invoked.
  it('does not launch when the confirm is cancelled', () => {
    setAgentTaskLauncher(launchMock);
    onCommitButtonClick(proj);
    // Simulate cancel: onConfirm is simply never called.
    expect(launchMock).not.toHaveBeenCalled();
  });

  // Scenario: no project folder → no-op (no dialog, no launch).
  it('is a no-op when the project has no folder', () => {
    setAgentTaskLauncher(launchMock);
    onCommitButtonClick({ id: 'p1', path: null, name: 'Acme' });
    expect(showMock).not.toHaveBeenCalled();
    expect(launchMock).not.toHaveBeenCalled();
  });
});
