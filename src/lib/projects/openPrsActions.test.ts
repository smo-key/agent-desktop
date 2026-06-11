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
  sortPrsForPopover,
  type OpenPrs,
  type OpenPr
} from './openPrsActions';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ count: 0, pullsUrl: null, prs: [] });
  openPrsCache.clear();
});

// ─────────────────────────── warning-vs-checkmark + count ───────────────────────────

describe('openPrsView', () => {
  // Scenario: N>0 open PRs awaiting review → WARNING icon + the count.
  // The count comes from non-draft awaiting-review PRs (Rust sets it); view is
  // purely count-driven — it doesn't look at the prs array.
  it('shows the warning icon + count when one or more await review', () => {
    expect(openPrsView({ count: 3, pullsUrl: 'https://github.com/o/r/pulls', prs: [] })).toEqual({
      icon: WARNING_ICON,
      label: '3',
      warning: true
    });
    expect(openPrsView({ count: 1, pullsUrl: null, prs: [] }).icon).toBe(WARNING_ICON);
    expect(openPrsView({ count: 1, pullsUrl: null, prs: [] }).label).toBe('1');
  });

  // Scenario: none awaiting review → CHECKMARK icon + `0`.
  it('shows the checkmark icon + 0 when none await review', () => {
    expect(openPrsView({ count: 0, pullsUrl: 'https://github.com/o/r/pulls', prs: [] })).toEqual({
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
    expect(openPrsView({ count: -1, pullsUrl: null, prs: [] }).warning).toBe(false);
    expect(openPrsView({ count: -1, pullsUrl: null, prs: [] }).label).toBe('0');
  });
});

// ─────────────────────────── fetch + cache ───────────────────────────

describe('openPrsFor', () => {
  it('invokes open_prs_for and caches the result per path', async () => {
    invokeMock.mockResolvedValueOnce({
      count: 2,
      pullsUrl: 'https://github.com/o/r/pulls',
      prs: []
    });
    const r = await openPrsFor('/repo', 'main');
    expect(invokeMock).toHaveBeenCalledWith('open_prs_for', { repoPath: '/repo', base: 'main' });
    expect(r).toEqual({ count: 2, pullsUrl: 'https://github.com/o/r/pulls', prs: [] });
    expect(openPrsCache.get('/repo')).toEqual({
      count: 2,
      pullsUrl: 'https://github.com/o/r/pulls',
      prs: []
    });
  });

  it('degrades to the neutral unknown result when the command throws', async () => {
    invokeMock.mockRejectedValueOnce('gh missing');
    const r = await openPrsFor('/repo', 'main');
    expect(r).toEqual({ count: 0, pullsUrl: null, prs: [] });
    // Cached as the neutral result so the button reads checkmark/0, no error.
    expect(openPrsCache.get('/repo')).toEqual({ count: 0, pullsUrl: null, prs: [] });
  });
});

describe('refreshOpenPrs / cachedOpenPrs', () => {
  it('refreshes into the cache; cachedOpenPrs reads it back', async () => {
    invokeMock.mockResolvedValueOnce({
      count: 4,
      pullsUrl: 'https://github.com/o/r/pulls',
      prs: []
    });
    await refreshOpenPrs('/repo', 'main');
    expect(cachedOpenPrs('/repo')).toEqual({
      count: 4,
      pullsUrl: 'https://github.com/o/r/pulls',
      prs: []
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
    await onOpenPrsClick({
      count: 2,
      pullsUrl: 'https://github.com/o/r/pulls',
      prs: []
    });
    expect(invokeMock).toHaveBeenCalledWith('open_path', {
      path: 'https://github.com/o/r/pulls',
      app: null
    });
  });

  it('is a no-op when there is no URL (unknown / null result)', async () => {
    await onOpenPrsClick(null);
    await onOpenPrsClick({ count: 0, pullsUrl: null, prs: [] });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── sortPrsForPopover ───────────────────────────────

const pr = (
  n: number,
  isDraft: boolean,
  reviewDecision: string | null = null
): OpenPr => ({
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/o/r/pull/${n}`,
  isDraft,
  reviewDecision
});

describe('sortPrsForPopover', () => {
  // Scenario: non-draft PRs come before draft PRs; within each group order is
  // preserved (stable sort by original position).
  it('puts non-draft awaiting-review PRs first, drafts last', () => {
    const prs = [
      pr(1, false, 'REVIEW_REQUIRED'),
      pr(2, true, 'REVIEW_REQUIRED'),
      pr(3, false, null),
      pr(4, true, null)
    ];
    const sorted = sortPrsForPopover(prs);
    expect(sorted.map((p) => p.number)).toEqual([1, 3, 2, 4]);
  });

  // Approved non-draft PRs still show (non-draft first) but are not counted.
  it('keeps approved non-draft PRs in the non-draft group', () => {
    const prs = [pr(1, true, 'REVIEW_REQUIRED'), pr(2, false, 'APPROVED')];
    const sorted = sortPrsForPopover(prs);
    // Non-draft (approved) before draft.
    expect(sorted[0].number).toBe(2);
    expect(sorted[1].number).toBe(1);
  });

  it('returns empty for an empty input', () => {
    expect(sortPrsForPopover([])).toEqual([]);
  });

  it('preserves relative order within the non-draft group', () => {
    const prs = [
      pr(3, false),
      pr(1, false),
      pr(2, false)
    ];
    const sorted = sortPrsForPopover(prs);
    expect(sorted.map((p) => p.number)).toEqual([3, 1, 2]);
  });

  it('preserves relative order within the draft group', () => {
    const prs = [pr(3, true), pr(1, true), pr(2, true)];
    const sorted = sortPrsForPopover(prs);
    expect(sorted.map((p) => p.number)).toEqual([3, 1, 2]);
  });
});
