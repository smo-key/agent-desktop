// Pure PCM buffer math for the raw-audio capture path (voice STT slice, task
// 4.3). whisper.cpp needs raw 16 kHz mono PCM, so the capture wrapper taps the
// AudioContext for `Float32Array` chunks (decode-free) and accumulates them; this
// module holds the only non-trivial pure piece — concatenating those chunks —
// so it can be unit-tested without any browser audio API. The Rust side
// (`transcribe.rs`) does the resample + WAV encode + VAD gating; this stays a
// thin, allocation-correct concat.

/**
 * Concatenate a list of `Float32Array` audio chunks (all at the same sample
 * rate, mono) into a single contiguous `Float32Array`, in order. An empty list
 * yields an empty array. The chunks are copied (the result owns its buffer), so
 * the caller may reuse/free the inputs.
 */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Bucket a magnitude spectrum (e.g. an AnalyserNode's byte frequency data, 0–255)
 * into `count` contiguous bars, averaging each bucket and normalizing to [0, 1].
 * Used to drive the recording waveform (7 rounded bars). An empty input yields
 * `count` zeros. Pure so the bar math is unit-tested without a browser AudioContext.
 */
export function bucketBars(mags: ArrayLike<number>, count: number): number[] {
  if (count <= 0) return [];
  const n = mags.length;
  if (n === 0) return new Array(count).fill(0);
  const per = Math.max(1, Math.floor(n / count));
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * per;
    const end = i === count - 1 ? n : Math.min(n, start + per);
    let sum = 0;
    let c = 0;
    for (let j = start; j < end; j++) {
      sum += mags[j];
      c++;
    }
    out.push(c > 0 ? sum / c / 255 : 0);
  }
  return out;
}
