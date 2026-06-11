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

import { pushPopoverOpen } from './pushPopover';
import { pushProject } from '$lib/projects/projectGitActions';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe('pushPopoverOpen', () => {
  // Scenario: popover opens when ahead > 0 and a push handler is wired
  it('returns true when ahead > 0 and a push handler is present', () => {
    expect(pushPopoverOpen(3, true)).toBe(true);
  });

  // Scenario: inert when ahead === 0 (even if push handler present)
  it('returns false when ahead is 0', () => {
    expect(pushPopoverOpen(0, true)).toBe(false);
  });

  // Scenario: inert when ahead is null (git couldn't answer)
  it('returns false when ahead is null', () => {
    expect(pushPopoverOpen(null, true)).toBe(false);
  });

  // Scenario: inert when no push handler is wired (project pane — no action)
  it('returns false when no push handler wired', () => {
    expect(pushPopoverOpen(5, false)).toBe(false);
  });

  // Scenario: inert when ahead is undefined
  it('returns false when ahead is undefined', () => {
    expect(pushPopoverOpen(undefined, true)).toBe(false);
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
