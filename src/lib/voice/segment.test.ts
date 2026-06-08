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
  it('returns null when less than the window has accrued', () => {
    // Only 3s of audio total, window is 6s → nothing older than the window.
    const samples = new Float32Array(3 * SR).fill(0.5);
    expect(commitCut(samples, 0, samples.length, SR, WIN)).toBeNull();
  });

  it('returns null exactly at the window boundary (no older audio yet)', () => {
    const end = 6 * SR; // end - committed == window → not strictly greater
    const samples = new Float32Array(end).fill(0.5);
    expect(commitCut(samples, 0, end, SR, WIN)).toBeNull();
  });

  it('cuts near the target (end - window) when over the window', () => {
    // 10s of all-speech audio: target cut = end - 6s = 4s. No silence anywhere, so
    // it falls back to the target.
    const end = 10 * SR;
    const samples = new Float32Array(end).fill(0.5);
    const cut = commitCut(samples, 0, end, SR, WIN);
    expect(cut).not.toBeNull();
    expect(cut).toBe(end - WIN * SR);
  });

  it('prefers a silence boundary near the target over the raw target', () => {
    const end = 10 * SR;
    const target = end - WIN * SR; // 4s
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

  it('advances monotonically (cut is strictly past committedSamples)', () => {
    const end = 20 * SR;
    const samples = new Float32Array(end).fill(0.5);
    const committed = 5 * SR;
    const cut = commitCut(samples, committed, end, SR, WIN);
    expect(cut).not.toBeNull();
    expect(cut!).toBeGreaterThan(committed);
    // And it never leaves more than the window unprocessed.
    expect(end - cut!).toBeLessThanOrEqual(WIN * SR);
  });

  it('returns null when the unfinalized span is within the window after prior commits', () => {
    // committed at 5s, end at 10s → only 5s unprocessed (< 6s window) → null.
    const end = 10 * SR;
    const samples = new Float32Array(end).fill(0.5);
    expect(commitCut(samples, 5 * SR, end, SR, WIN)).toBeNull();
  });
});
