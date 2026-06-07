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
