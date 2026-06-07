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

import { concatFloat32, bucketBars } from './pcm';

// RAW-PCM PATH (STT slice, task 4.3): whisper.cpp needs raw 16 kHz mono PCM, so
// alongside the `MediaRecorder` Blob path we tap the `AudioContext` for
// `Float32Array` PCM at the context sample rate (decode-free — no Opus/WebM
// container to decode). The Rust side (`transcribe.rs`) resamples to 16 kHz,
// encodes a WAV, and VAD-gates it. We use a `ScriptProcessorNode` (deprecated but
// universally available, incl. the macOS WKWebView, with no separate worklet
// module file to bundle); the pure concat math lives in the tested `pcm.ts`.

/** How often (ms) `MediaRecorder` flushes a chunk via `onChunk` while recording. */
const CHUNK_TIMESLICE_MS = 250;

/** ScriptProcessor buffer size (frames). 4096 ≈ 85ms @ 48k — low overhead. */
const PCM_BUFFER_SIZE = 4096;

export interface MicCaptureOptions {
  /** Called for each audio chunk while recording (live STT transport). */
  onChunk?: (chunk: Blob) => void;
  /** Called once with the full recording when capture stops (final STT pass). */
  onStop?: (full: Blob) => void;
  /**
   * Called for each raw-PCM frame buffer while recording (live STT transport for
   * the whisper.cpp sidecar). `samples` is mono `Float32Array` in [-1, 1] at
   * `sampleRate` (the AudioContext rate, typically 48000); the chunk is a COPY,
   * safe to retain. Enables the raw-PCM path without decoding a container.
   */
  onPcm?: (samples: Float32Array, sampleRate: number) => void;
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
  // Raw-PCM path state (task 4.3).
  #audioCtx: AudioContext | null = null;
  #source: MediaStreamAudioSourceNode | null = null;
  #processor: ScriptProcessorNode | null = null;
  #pcmChunks: Float32Array[] = [];
  #sampleRate = 0;
  // Live-level analyser for the recording waveform.
  #analyser: AnalyserNode | null = null;
  #freqBuf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
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

    // Raw-PCM tap (task 4.3): an AudioContext + ScriptProcessor over the same
    // stream produces decode-free Float32 PCM for the whisper.cpp sidecar. Best-
    // effort — if the AudioContext is unavailable the Blob path still works.
    try {
      const AC: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      this.#audioCtx = ctx;
      this.#sampleRate = ctx.sampleRate;
      this.#pcmChunks = [];
      const source = ctx.createMediaStreamSource(stream);
      this.#source = source;
      // Analyser tap for the live waveform (does not need to reach destination).
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256; // 128 frequency bins — plenty for 7 bars.
      analyser.smoothingTimeConstant = 0.7;
      this.#analyser = analyser;
      this.#freqBuf = new Uint8Array(analyser.frequencyBinCount);
      source.connect(analyser);
      const processor = ctx.createScriptProcessor(PCM_BUFFER_SIZE, 1, 1);
      this.#processor = processor;
      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        // Copy the channel data — the node reuses its buffer across callbacks.
        const frame = new Float32Array(e.inputBuffer.getChannelData(0));
        this.#pcmChunks.push(frame);
        this.#opts.onPcm?.(frame, ctx.sampleRate);
      };
      source.connect(processor);
      // ScriptProcessor only fires while connected to the graph; route through a
      // muted gain so we don't echo the mic to the speakers.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      processor.connect(sink);
      sink.connect(ctx.destination);
    } catch {
      // No AudioContext (or createScriptProcessor unsupported) — the Blob path
      // remains; getPcm() will simply return an empty buffer.
      this.#audioCtx = null;
    }
  }

  /**
   * Return the full raw-PCM utterance captured so far as one contiguous mono
   * `Float32Array` plus its `sampleRate`, for the final whisper pass. Returns an
   * empty buffer (sampleRate 0) when the raw-PCM tap never ran. Pure concat is in
   * the tested `pcm.ts`.
   */
  getPcm(): { samples: Float32Array; sampleRate: number } {
    return { samples: concatFloat32(this.#pcmChunks), sampleRate: this.#sampleRate };
  }

  /**
   * Sample the current mic level as `count` normalized bars (0–1) for the live
   * waveform. Reads the analyser's instantaneous frequency magnitudes and buckets
   * them (pure `bucketBars`). Returns `count` zeros when the analyser isn't running
   * (no AudioContext / not started), so the UI renders a flat idle waveform.
   */
  getBars(count: number): number[] {
    const analyser = this.#analyser;
    if (!analyser) return new Array(count).fill(0);
    analyser.getByteFrequencyData(this.#freqBuf);
    return bucketBars(this.#freqBuf, count);
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

    // Tear down the raw-PCM graph (disconnect nodes, close the context).
    if (this.#processor) {
      this.#processor.onaudioprocess = null;
      try {
        this.#processor.disconnect();
      } catch {
        // Already disconnected — ignore.
      }
    }
    this.#processor = null;
    if (this.#analyser) {
      try {
        this.#analyser.disconnect();
      } catch {
        // Already disconnected — ignore.
      }
    }
    this.#analyser = null;
    if (this.#source) {
      try {
        this.#source.disconnect();
      } catch {
        // Already disconnected — ignore.
      }
    }
    this.#source = null;
    if (this.#audioCtx) {
      void this.#audioCtx.close().catch(() => {
        // Closing a context that's already closed — ignore.
      });
    }
    this.#audioCtx = null;

    const stream = this.#stream;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    this.#stream = null;
  }
}
