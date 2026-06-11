import { describe, expect, it, vi, beforeEach } from 'vitest';

// `invoke` is mocked so the open-PRs wiring can be asserted without a live Tauri
// backend. Mock pattern mirrors prActions / projectGitActions tests.
const invokeMock = vi.fn(
  async (..._a: unknown[]): Promise<unknown> => ({ count: 0, pullsUrl: null })
);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import {
  WARNING_ICON,
  CHECKMARK_ICON,
  openPrsView,
  openPrsFor,
  refreshOpenPrs,
  cachedOpenPrs,
  onOpenPrsClick,
  openPrsCache,
  type OpenPrs
} from './openPrsActions';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ count: 0, pullsUrl: null });
  openPrsCache.clear();
});

// ─────────────────────────── warning-vs-checkmark + count ───────────────────────────

describe('openPrsView', () => {
  // Scenario: N>0 open PRs awaiting review → WARNING icon + the count.
  it('shows the warning icon + count when one or more await review', () => {
    expect(openPrsView({ count: 3, pullsUrl: 'https://github.com/o/r/pulls' })).toEqual({
      icon: WARNING_ICON,
      label: '3',
      warning: true
    });
    expect(openPrsView({ count: 1, pullsUrl: null }).icon).toBe(WARNING_ICON);
    expect(openPrsView({ count: 1, pullsUrl: null }).label).toBe('1');
  });

  // Scenario: none awaiting review → CHECKMARK icon + `0`.
  it('shows the checkmark icon + 0 when none await review', () => {
    expect(openPrsView({ count: 0, pullsUrl: 'https://github.com/o/r/pulls' })).toEqual({
      icon: CHECKMARK_ICON,
      label: '0',
      warning: false
    });
  });

  // Scenario: unknown (gh unavailable) → neutral checkmark/`0`, no error.
  it('shows the neutral checkmark/0 state for unknown (null result)', () => {
    expect(openPrsView(null)).toEqual({
      icon: CHECKMARK_ICON,
      label: '0',
      warning: false
    });
    expect(openPrsView(undefined)).toEqual({
      icon: CHECKMARK_ICON,
      label: '0',
      warning: false
    });
  });

  // A negative/garbage count never reads as a warning (defensive).
  it('treats a non-positive count as the neutral state', () => {
    expect(openPrsView({ count: -1, pullsUrl: null }).warning).toBe(false);
    expect(openPrsView({ count: -1, pullsUrl: null }).label).toBe('0');
  });
});

// ─────────────────────────── fetch + cache ───────────────────────────

describe('openPrsFor', () => {
  it('invokes open_prs_for and caches the result per path', async () => {
    invokeMock.mockResolvedValueOnce({ count: 2, pullsUrl: 'https://github.com/o/r/pulls' });
    const r = await openPrsFor('/repo', 'main');
    expect(invokeMock).toHaveBeenCalledWith('open_prs_for', { repoPath: '/repo', base: 'main' });
    expect(r).toEqual({ count: 2, pullsUrl: 'https://github.com/o/r/pulls' });
    expect(openPrsCache.get('/repo')).toEqual({
      count: 2,
      pullsUrl: 'https://github.com/o/r/pulls'
    });
  });

  it('degrades to the neutral unknown result when the command throws', async () => {
    invokeMock.mockRejectedValueOnce('gh missing');
    const r = await openPrsFor('/repo', 'main');
    expect(r).toEqual({ count: 0, pullsUrl: null });
    // Cached as the neutral result so the button reads checkmark/0, no error.
    expect(openPrsCache.get('/repo')).toEqual({ count: 0, pullsUrl: null });
  });
});

describe('refreshOpenPrs / cachedOpenPrs', () => {
  it('refreshes into the cache; cachedOpenPrs reads it back', async () => {
    invokeMock.mockResolvedValueOnce({ count: 4, pullsUrl: 'https://github.com/o/r/pulls' });
    await refreshOpenPrs('/repo', 'main');
    expect(cachedOpenPrs('/repo')).toEqual({
      count: 4,
      pullsUrl: 'https://github.com/o/r/pulls'
    });
  });

  it('refreshOpenPrs is a no-op with no path', async () => {
    await refreshOpenPrs(null, 'main');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('cachedOpenPrs returns null when nothing is cached', () => {
    expect(cachedOpenPrs('/never')).toBeNull();
    expect(cachedOpenPrs(null)).toBeNull();
  });
});

// ─────────────────────────── click → open GitHub pulls page ───────────────────────────

describe('onOpenPrsClick', () => {
  // Scenario: click → opens the repo's pull-requests page on GitHub.
  it('opens the pulls URL externally via open_path', async () => {
    await onOpenPrsClick({ count: 2, pullsUrl: 'https://github.com/o/r/pulls' });
    expect(invokeMock).toHaveBeenCalledWith('open_path', {
      path: 'https://github.com/o/r/pulls',
      app: null
    });
  });

  it('is a no-op when there is no URL (unknown / null result)', async () => {
    await onOpenPrsClick(null);
    await onOpenPrsClick({ count: 0, pullsUrl: null });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
