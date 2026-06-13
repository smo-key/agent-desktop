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
  openPrsCache,
  sortPrsForPopover,
  reviewStatus,
  authorAvatarUrl,
  authorInitial,
  authorLabel,
  prUpdatedSeconds,
  type OpenPrs,
  type OpenPr,
  type PrAuthor
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

// ─────────────────────────── sortPrsForPopover ───────────────────────────────

const pr = (
  n: number,
  isDraft: boolean,
  reviewDecision: string | null = null,
  author: PrAuthor | null = null,
  updatedAt: string | null = null
): OpenPr => ({
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/o/r/pull/${n}`,
  isDraft,
  reviewDecision,
  author,
  updatedAt
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

// ─────────────────────────── reviewStatus ───────────────────────────────
// Scenario: each row shows a review-status icon (approved/changes/required) +
// Scenario: a PR with no requested review shows a neutral status icon.

describe('reviewStatus', () => {
  it('Each row shows a review-status icon', () => {
    expect(reviewStatus('APPROVED')).toEqual({ icon: 'check', tone: 'approved', label: 'Approved' });
    expect(reviewStatus('CHANGES_REQUESTED')).toEqual({
      icon: 'x',
      tone: 'changes',
      label: 'Changes requested'
    });
    expect(reviewStatus('REVIEW_REQUIRED')).toEqual({
      icon: 'clock',
      tone: 'required',
      label: 'Review required'
    });
  });

  it('A PR with no requested review shows a neutral status icon', () => {
    const neutral = { icon: 'circle', tone: 'none', label: 'No review requested' };
    expect(reviewStatus(null)).toEqual(neutral);
    expect(reviewStatus('')).toEqual(neutral);
    expect(reviewStatus(undefined)).toEqual(neutral);
    // An unrecognized decision string is treated as neutral, never as a positive state.
    expect(reviewStatus('SOMETHING_ELSE')).toEqual(neutral);
  });
});

// ─────────────────────────── author helpers ───────────────────────────────

const author = (login: string, name: string | null = null, isBot = false): PrAuthor => ({
  login,
  name,
  isBot
});

describe('author avatar + label + initial', () => {
  it('Each row shows the author avatar with a name on hover', () => {
    // Avatar URL is derived from the login; the hover label prefers the display name.
    expect(authorAvatarUrl('octocat')).toBe('https://github.com/octocat.png?size=40');
    expect(authorAvatarUrl('octocat', 16)).toBe('https://github.com/octocat.png?size=16');
    expect(authorLabel(author('octocat', 'The Octocat'))).toBe('The Octocat');
    // No display name → @login.
    expect(authorLabel(author('octocat'))).toBe('@octocat');
  });

  it('Author avatar falls back when the image cannot load', () => {
    // The textual fallback glyph: the initial of the name, else the login.
    expect(authorInitial(author('octocat', 'The Octocat'))).toBe('T');
    expect(authorInitial(author('octocat'))).toBe('O');
    // Unknown author → a neutral placeholder, never a broken image / login-less URL.
    expect(authorInitial(null)).toBe('?');
    expect(authorAvatarUrl(null)).toBeNull();
    expect(authorLabel(null)).toBe('unknown');
  });

  it('encodes odd logins into the avatar URL', () => {
    // Defensive: a login with URL-significant characters is encoded, never injected raw.
    expect(authorAvatarUrl('a/b?c')).toBe('https://github.com/a%2Fb%3Fc.png?size=40');
  });
});

// ─────────────────────────── prUpdatedSeconds ───────────────────────────────

describe('prUpdatedSeconds', () => {
  it('Each row shows when the PR was last updated', () => {
    // ISO-8601 → unix SECONDS (for friendlyTime). 2026-06-12T14:30:00Z = 1_781_274_600.
    expect(prUpdatedSeconds('2026-06-12T14:30:00Z')).toBe(Math.floor(Date.parse('2026-06-12T14:30:00Z') / 1000));
  });

  it('Enriched row context degrades gracefully', () => {
    // Missing / unparseable last-updated → null, so the row simply omits the time.
    expect(prUpdatedSeconds(null)).toBeNull();
    expect(prUpdatedSeconds(undefined)).toBeNull();
    expect(prUpdatedSeconds('')).toBeNull();
    expect(prUpdatedSeconds('not a date')).toBeNull();
  });
});
