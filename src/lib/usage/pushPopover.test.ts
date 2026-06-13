import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/api/core so commitsToPush can be tested without a live backend.
const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => []);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

// Mock toastStore to avoid DOM dependency.
vi.mock('../ui/toastStore.svelte', () => ({ toast: { show: vi.fn() } }));

// Mock gitBusy to prevent reactive-state errors in the unit-test environment.
vi.mock('../projects/projectGitBusy.svelte', () => ({
  gitBusy: { isBusy: vi.fn(() => false), begin: vi.fn(), end: vi.fn() }
}));

import { pushPopoverOpen, aheadPillEnabled } from './pushPopover';
import { pushProject } from '$lib/projects/projectGitActions';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe('pushPopoverOpen', () => {
  // Scenario: the popover appears in ALL cases when a push handler is wired — the
  // user takes the secondary action (push / publish) inside it.
  it('returns true whenever a push handler is wired', () => {
    expect(pushPopoverOpen(true)).toBe(true);
  });

  // Scenario: inert when no push handler is wired (no real project folder bound)
  it('returns false when no push handler wired', () => {
    expect(pushPopoverOpen(false)).toBe(false);
  });
});

describe('aheadPillEnabled', () => {
  // Scenario: published branch with commits to push → highlighted
  it('is enabled when ahead > 0 on a published branch', () => {
    expect(aheadPillEnabled(2, true)).toBe(true);
  });

  // Scenario: published branch fully in sync → neutral empty state
  it('is disabled (neutral) when a published branch has nothing to push', () => {
    expect(aheadPillEnabled(0, true)).toBe(false);
  });

  // Scenario: unpushed branch with commits → highlighted (publishes on push)
  it('is enabled when an unpushed branch has commits', () => {
    expect(aheadPillEnabled(3, false)).toBe(true);
  });

  // Scenario: unpushed branch with NO commits → still highlighted (publish branch)
  it('is enabled when an unpushed branch has zero commits', () => {
    expect(aheadPillEnabled(0, false)).toBe(true);
  });

  // Scenario: unknown count (e.g. no remote) → neutral, regardless of upstream
  it('is disabled (neutral) when the count is unknown', () => {
    expect(aheadPillEnabled(null, false)).toBe(false);
    expect(aheadPillEnabled(undefined, true)).toBe(false);
    expect(aheadPillEnabled(null, null)).toBe(false);
  });
});

describe('pushProject integration (via projectGitActions)', () => {
  // Scenario: "Push now" button calls pushProject with the project path/name/id.
  it('invokes git_push with the correct repoPath', async () => {
    invokeMock.mockResolvedValueOnce('Everything up-to-date');
    await pushProject('/repo', 'Acme', 'p1');
    expect(invokeMock).toHaveBeenCalledWith('git_push', { repoPath: '/repo' });
  });
});
