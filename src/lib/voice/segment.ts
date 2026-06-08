// PURE live-partials FINALIZE-CUT helper for the full-message-retention pipeline.
//
// The live overlay must show the ENTIRE message while only re-transcribing a
// bounded trailing window each tick (see pipeline.ts `#tickPartial`). Audio older
// than the reprocess window is finalized ONCE into committed text and never
// reprocessed. `commitCut` decides — purely — whether enough audio has scrolled
// past the window to finalize, and WHERE to cut, preferring a silence boundary
// near the target so a word isn't split mid-utterance.
//
// Pure + unit-tested here; the pipeline owns the surrounding retention state and
// the actual transcription calls.

/** RMS energy of a Float32 PCM slice (mono, normalized to [-1, 1]). */
function rms(samples: Float32Array, start: number, end: number): number {
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (end - start));
}

/** Tunables for the silence search (mirrors the Rust VAD threshold/frame sizing). */
export interface CommitCutOpts {
  /** Frame length (samples) the silence search scans in. */
  frameLen: number;
  /** RMS below this is treated as silence. */
  threshold: number;
  /** How far (samples) on each side of the target to hunt for a silence frame. */
  searchRadius: number;
}

const DEFAULT_OPTS: CommitCutOpts = {
  frameLen: 512,
  // Matches transcribe.rs VAD_THRESHOLD (≈ -48 dBFS) so the cut prefers true gaps.
  threshold: 0.004,
  // ~0.5s at 16k: enough to snap to a nearby pause without wandering far from the
  // target (which would let the unprocessed tail grow beyond the window).
  searchRadius: 8000
};

/**
 * Decide the sample index up to which audio should be FINALIZED (committed) given
 * the captured PCM so far.
 *
 *  - `samples`            the full captured PCM (mono Float32).
 *  - `committedSamples`   how many leading samples are already committed.
 *  - `end`               total captured samples (the high-water mark this tick).
 *  - `sampleRate`        capture sample rate (Hz).
 *  - `reprocessWindowSec` the trailing window (s) that is re-transcribed each tick.
 *  - `opts`              silence-search tunables.
 *
 * Returns `null` until the UNFINALIZED span (`end - committedSamples`) exceeds
 * **2×** the window — so we only ever finalize in SUBSTANTIAL (~window-sized)
 * chunks. Finalizing tiny per-tick slivers (which is what triggering at 1× would
 * do) makes whisper transcribe ~100ms fragments → empty/garbage → committed text
 * never accumulates and older text is lost. When it does fire it returns the cut
 * index, which:
 *   - leaves AT MOST `reprocessWindowSec` of trailing audio (`end - cut <= window`),
 *     so the per-tick reprocess span stays bounded (window..2×window),
 *   - prefers a silence frame within `searchRadius` of the target `end - window`
 *     (so the boundary falls in a pause, not mid-word), falling back to the raw
 *     target when no silence is found,
 *   - is strictly greater than `committedSamples` (monotonic — never re-finalizes).
 */
export function commitCut(
  samples: Float32Array,
  committedSamples: number,
  end: number,
  sampleRate: number,
  reprocessWindowSec: number,
  opts: CommitCutOpts = DEFAULT_OPTS
): number | null {
  const windowSamples = Math.floor(reprocessWindowSec * sampleRate);
  // Only finalize once MORE than 2× the window has accrued, so each committed
  // chunk is ~window-sized (transcribable) rather than a tiny per-tick sliver.
  if (end - committedSamples <= 2 * windowSamples) return null;

  // The latest cut that still leaves ≤ window trailing. Cutting here (or earlier)
  // bounds the reprocess window.
  const target = end - windowSamples;

  const { frameLen, threshold, searchRadius } = opts;
  // Hunt for a silence frame near the target. Bound the search so the chosen cut
  // can never leave more than the window unprocessed (cut ≤ target) nor re-finalize
  // committed audio (cut > committedSamples).
  const lo = Math.max(committedSamples + frameLen, target - searchRadius);
  const hi = Math.min(target, target + searchRadius);

  let best: number | null = null;
  let bestDist = Infinity;
  for (let frameStart = lo; frameStart + frameLen <= Math.max(hi, lo) + 1 && frameStart < end; frameStart += frameLen) {
    const frameEnd = Math.min(frameStart + frameLen, end);
    if (rms(samples, frameStart, frameEnd) <= threshold) {
      const dist = Math.abs(frameStart - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = frameStart;
      }
    }
  }

  // Prefer the silence boundary; fall back to the raw target. Either way clamp to
  // (committedSamples, target] so it's monotonic and bounded.
  let cut = best ?? target;
  if (cut > target) cut = target;
  if (cut <= committedSamples) cut = target;
  return cut;
}
