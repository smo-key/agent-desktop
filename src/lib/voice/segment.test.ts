import { describe, expect, it } from 'vitest';
import { commitCut } from './segment';

// PURE tests for the live-partials FINALIZE-CUT helper. `commitCut` decides, given
// the captured PCM so far, whether enough audio has scrolled past the reprocess
// window to be locked into committed text — and WHERE to cut (preferring a silence
// boundary near the target so a word isn't split). The pipeline owns all
// retention state; this is the only pure, testable piece of that logic.

const SR = 16_000;
const WIN = 6; // reprocess window seconds → 96_000 samples at 16k

/** Build a buffer that is loud (speech) everywhere except a silent gap. */
function withSilenceGap(total: number, gapStart: number, gapLen: number): Float32Array {
  const buf = new Float32Array(total);
  for (let i = 0; i < total; i++) buf[i] = i >= gapStart && i < gapStart + gapLen ? 0 : 0.5;
  return buf;
}

describe('commitCut — finalize-cut for the sliding reprocess window', () => {
  it('returns null until MORE than 2× the window has accrued', () => {
    // 10s total, window 6s → 10s ≤ 12s (2×window) → don't finalize tiny slivers yet.
    const samples = new Float32Array(10 * SR).fill(0.5);
    expect(commitCut(samples, 0, samples.length, SR, WIN)).toBeNull();
  });

  it('returns null exactly at the 2× boundary', () => {
    const end = 12 * SR; // end - committed == 2×window → not strictly greater
    const samples = new Float32Array(end).fill(0.5);
    expect(commitCut(samples, 0, end, SR, WIN)).toBeNull();
  });

  it('cuts near the target (end - window) once over 2× the window', () => {
    // 14s of all-speech audio (>12s): target cut = end - 6s = 8s. No silence, so it
    // falls back to the target → leaves exactly the window trailing.
    const end = 14 * SR;
    const samples = new Float32Array(end).fill(0.5);
    const cut = commitCut(samples, 0, end, SR, WIN);
    expect(cut).not.toBeNull();
    expect(cut).toBe(end - WIN * SR);
    // The committed chunk is ~window-sized (substantial), not a tiny sliver.
    expect(cut!).toBeGreaterThanOrEqual(WIN * SR);
  });

  it('prefers a silence boundary near the target over the raw target', () => {
    const end = 14 * SR;
    const target = end - WIN * SR; // 8s
    // Put a silent gap a little before the target; the cut should snap to it.
    const gapStart = target - 4000;
    const gapLen = 2000;
    const samples = withSilenceGap(end, gapStart, gapLen);
    const cut = commitCut(samples, 0, end, SR, WIN);
    expect(cut).not.toBeNull();
    // Cut lands inside / at the silent gap (within the search neighborhood), not at
    // the raw mid-speech target.
    expect(cut!).toBeGreaterThanOrEqual(gapStart);
    expect(cut!).toBeLessThanOrEqual(gapStart + gapLen);
  });

  it('snaps to a silence gap just AFTER the target (search is symmetric)', () => {
    const end = 14 * SR;
    const target = end - WIN * SR; // 8s
    // Gap sits a little AFTER the target; the nearest pause is past it. The cut
    // should still snap to the gap (not fall back to the mid-speech target), and
    // still leave a trailing window (cut < end).
    const gapStart = target + 2000;
    const gapLen = 2000;
    const samples = withSilenceGap(end, gapStart, gapLen);
    const cut = commitCut(samples, 0, end, SR, WIN);
    expect(cut).not.toBeNull();
    expect(cut!).toBeGreaterThan(target);
    expect(cut!).toBeGreaterThanOrEqual(gapStart);
    expect(cut!).toBeLessThanOrEqual(gapStart + gapLen);
    expect(cut!).toBeLessThan(end); // a trailing window always remains
  });

  it('advances monotonically and leaves only the window trailing', () => {
    const end = 25 * SR;
    const samples = new Float32Array(end).fill(0.5);
    const committed = 5 * SR; // 20s unprocessed > 12s
    const cut = commitCut(samples, committed, end, SR, WIN);
    expect(cut).not.toBeNull();
    expect(cut!).toBeGreaterThan(committed);
    expect(end - cut!).toBeLessThanOrEqual(WIN * SR);
  });

  it('returns null when the unfinalized span is within 2× the window after prior commits', () => {
    // committed at 5s, end at 16s → 11s unprocessed (≤ 12s) → null.
    const end = 16 * SR;
    const samples = new Float32Array(end).fill(0.5);
    expect(commitCut(samples, 5 * SR, end, SR, WIN)).toBeNull();
  });
});
