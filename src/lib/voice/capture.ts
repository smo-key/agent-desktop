// Thin microphone-capture wrapper around the browser media APIs. This file
// deliberately holds ONLY the untestable bits — `navigator.mediaDevices
// .getUserMedia` and `MediaRecorder` — so jsdom-headless tests don't touch them
// (jsdom implements neither). The decision logic (denied vs error + guidance)
// lives in the PURE, unit-tested `permission.ts`.
//
// Lifecycle is driven by VoicePanel.svelte's `$effect`: `start()` on open,
// `stop()` on close / teardown. `stop()` releases the OS mic so the system mic
// indicator turns off.
//
// AUDIO HANDOFF (for the later STT slice — tasks 4.x):
//   - `onChunk(chunk: Blob)` fires for each `MediaRecorder` `dataavailable`
//     event while recording (cadence set by the `timeslice` start arg). Use this
//     to stream audio to the whisper.cpp sidecar for live partials.
//   - `onStop(full: Blob)` fires once when recording stops, with the full
//     concatenated recording (all chunks joined, same MIME type). Use this for
//     the final large-model pass over the whole utterance.
//   The Blob MIME type is whatever the platform `MediaRecorder` picked
//   (`recorder.mimeType`); on the macOS WKWebView this is typically an
//   Opus/WebM or AAC container — the STT slice is responsible for decoding it
//   (or this wrapper can be switched to an AudioContext + Float32Array tap if a
//   raw-PCM transport proves lower-latency). MANUAL: live capture is verified in
//   a real window (task 9.1), not headlessly.

/** How often (ms) `MediaRecorder` flushes a chunk via `onChunk` while recording. */
const CHUNK_TIMESLICE_MS = 250;

export interface MicCaptureOptions {
  /** Called for each audio chunk while recording (live STT transport). */
  onChunk?: (chunk: Blob) => void;
  /** Called once with the full recording when capture stops (final STT pass). */
  onStop?: (full: Blob) => void;
}

/**
 * Wraps a single microphone session: one `MediaStream` + one `MediaRecorder`.
 * Construct once per panel-open; call `start()` then `stop()`. `stop()` is
 * idempotent and safe to call when never started.
 */
export class MicCapture {
  #stream: MediaStream | null = null;
  #recorder: MediaRecorder | null = null;
  #chunks: Blob[] = [];
  readonly #opts: MicCaptureOptions;

  constructor(opts: MicCaptureOptions = {}) {
    this.#opts = opts;
  }

  /**
   * Request the microphone and begin recording. Rejects with the raw
   * `getUserMedia` error (e.g. a `NotAllowedError` DOMException) so the caller
   * can classify it via `permission.ts`. On success the OS mic indicator turns
   * on until `stop()` is called.
   */
  async start(): Promise<void> {
    // Re-entrancy guard: already capturing.
    if (this.#stream) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.#stream = stream;
    this.#chunks = [];

    const recorder = new MediaRecorder(stream);
    this.#recorder = recorder;

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        this.#chunks.push(e.data);
        this.#opts.onChunk?.(e.data);
      }
    };
    recorder.onstop = () => {
      if (this.#chunks.length > 0) {
        const type = recorder.mimeType || this.#chunks[0]?.type || '';
        this.#opts.onStop?.(new Blob(this.#chunks, { type }));
      }
    };

    recorder.start(CHUNK_TIMESLICE_MS);
  }

  /**
   * Stop recording and release the microphone (all tracks stopped + stream
   * dropped), so the OS mic indicator turns off. Safe to call when not started
   * or already stopped.
   */
  stop(): void {
    const recorder = this.#recorder;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Already stopped / detached — ignore.
      }
    }
    this.#recorder = null;

    const stream = this.#stream;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    this.#stream = null;
  }
}
