import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agentTaskLauncher dependency in prActions
const launchMock = vi.fn((..._a: unknown[]) => {});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ kind: 'unknown' }))
}));

vi.mock('../ui/confirmStore.svelte', () => ({
  confirmModal: { show: vi.fn() }
}));

import { setAgentTaskLauncher } from '$lib/projects/prActions';
import { commitPopoverOpen, spawnCommitFromPopover } from './commitPopover';

beforeEach(() => {
  launchMock.mockReset();
  setAgentTaskLauncher(null);
});

describe('commitPopoverOpen', () => {
  // Scenario: popover should open when modified > 0 and onCommit is wired
  it('returns true when modified > 0 and a commit handler is present', () => {
    expect(commitPopoverOpen(3, true)).toBe(true);
  });

  // Scenario: inert when modified === 0 (even if commit handler present)
  it('returns false when modified is 0', () => {
    expect(commitPopoverOpen(0, true)).toBe(false);
  });

  // Scenario: inert when modified is null
  it('returns false when modified is null', () => {
    expect(commitPopoverOpen(null, true)).toBe(false);
  });

  // Scenario: inert when no commit handler is wired
  it('returns false when no commit handler wired', () => {
    expect(commitPopoverOpen(5, false)).toBe(false);
  });
});

describe('spawnCommitFromPopover', () => {
  const proj = { id: 'p1', path: '/repo', name: 'Acme' };

  // Scenario: spawns agent task directly (no confirm dialog)
  it('invokes the launcher directly without a confirm dialog', () => {
    setAgentTaskLauncher(launchMock);
    spawnCommitFromPopover(proj);
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(launchMock.mock.calls[0][0]).toBe('p1');
    expect(String(launchMock.mock.calls[0][1]).toLowerCase()).toMatch(/commit/);
  });

  // Scenario: no-op when no launcher wired
  it('is a no-op when no launcher is wired', () => {
    spawnCommitFromPopover(proj);
    expect(launchMock).not.toHaveBeenCalled();
  });

  // Scenario: no-op when project has no folder
  it('is a no-op when project has no path', () => {
    setAgentTaskLauncher(launchMock);
    spawnCommitFromPopover({ id: 'p1', path: null, name: 'Acme' });
    expect(launchMock).not.toHaveBeenCalled();
  });
});
