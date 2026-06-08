// The dictation PIPELINE controller — the INTEGRATION/ASSEMBLY layer that ties the
// already-built voice slices into one flow driven by VoicePanel:
//
//   open → ensureModels (done in the panel) → MicCapture.start() + recording
//        → live partials over a Channel<TranscribeEvent> (overlay)
//        → STOP&INSERT: stop capture, getPcm(), voice_transcribe_final(pcm),
//          finishDictation(rawFinal) [polish per settings + verbatim insert]
//
// Two distinct teardown paths (a deliberate UX decision — see VoicePanel):
//   - stopAndInsert(): the user's explicit "Stop & insert" control. Finalizes the
//     utterance (final whisper pass → polish → verbatim insert into the focused
//     terminal), then closes the panel. The user reviews/edits the text IN THE
//     TERMINAL (no auto-submit), per spec — not in this panel.
//   - cancel(): the × button or Escape. DISCARDS the utterance: stop capture +
//     release the mic, NO transcription, NO insert. (Clicking outside the panel
//     does NOT cancel — the panel is a non-modal overlay with no scrim.)
//
// Pure/testable bits live in small exported functions (model-path resolution, the
// partial-event reducer); `invoke`, `Channel`, `MicCapture`, and the DOM stay in
// thin, untested wrappers below.
//
// Live partials are driven from the frontend with FULL-MESSAGE RETENTION over a
// sliding REPROCESS window: a short interval (~100ms) re-transcribes only the
// trailing few seconds of audio via the persistent `whisper-server`
// (`voice_transcribe_partial`, tiny model resident → ≤tens of ms per pass), while
// audio older than the window is finalized ONCE into committed text and never
// reprocessed. The overlay shows committed + the live window, so the WHOLE message
// stays visible while per-tick cost stays bounded. The final pass is unchanged: it
// uses the tier model via `voice_transcribe_final` over the whole utterance.
//
// Runs end-to-end once the whisper sidecars + a model are provisioned (the bundled
// tiny model is loaded by whisper-server for partials); polish additionally needs
// the llama-server.

import { invoke } from '@tauri-apps/api/core';
import { voice } from '$lib/settings/voice.svelte';
import { MicCapture } from './capture';
import { finishDictation } from './polish';
import { voiceStore } from './voiceStore.svelte';
import { commitCut } from './segment';
import type { VoiceModelTier } from '$lib/settings/voice.svelte';

// --- Pure: model-path resolution --------------------------------------------

/**
 * The FINAL-pass whisper model FILENAME for a tier, mirroring the Rust registry
 * (`models::final_model_for`): `fast` → small, `accurate` → large-v3-turbo. Kept
 * here only so the mapping is documented + unit-tested on the frontend; the Rust
 * `voice_model_path(tier)` command is the runtime source of the on-disk path.
 */
export function finalModelFilename(tier: VoiceModelTier): string {
  return tier === 'fast' ? 'ggml-small.bin' : 'ggml-large-v3-turbo-q5_0.bin';
}

/**
 * PURE: choose the model path to hand to `voice_transcribe_final`.
 *
 *  - Prefer `tierPath` (the tier's downloaded final model) when present.
 *  - Otherwise fall back to `bundledTinyPath` (the always-shipped tiny model) so
 *    dictation works on first run / offline before larger models land.
 *  - When NEITHER is available, return `null` — the caller treats this as "no
 *    model on disk" and skips the final pass rather than invoking with a bad
 *    path (spec: degrade gracefully, never crash).
 *
 * `tierPath`/`bundledTinyPath` are the resolved absolute paths (or null when the
 * file is absent), as returned by the `voice_model_path` / `voice_bundled_model_path`
 * Tauri commands.
 */
export function resolveFinalModelPath(
  tierPath: string | null,
  bundledTinyPath: string | null
): string | null {
  if (tierPath) return tierPath;
  if (bundledTinyPath) return bundledTinyPath;
  return null;
}

// --- Pure: partial-event reducer --------------------------------------------

/** TS mirror of the Rust `TranscribeEvent` (internally tagged on `event`). */
export type TranscribeEvent =
  | { event: 'partial'; text: string }
  | { event: 'final'; text: string }
  | { event: 'error'; message: string };

/** The visible effect a streamed transcribe event should have on the panel. */
export type TranscribeEffect =
  | { kind: 'partial'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'ignore' };

/**
 * PURE: map a streamed `TranscribeEvent` to the effect the controller applies to
 * `voiceStore`. `partial` → set the live overlay; `error` → surface it; `final`
 * is IGNORED here — the committed final text comes from the explicit stop path
 * (`voice_transcribe_final` + `finishDictation`), not the live stream, so a stray
 * stream `final` never races the authoritative final pass. Tested headlessly.
 */
export function reduceTranscribeEvent(ev: TranscribeEvent): TranscribeEffect {
  switch (ev.event) {
    case 'partial':
      return { kind: 'partial', text: ev.text };
    case 'error':
      return { kind: 'error', message: ev.message };
    case 'final':
    default:
      return { kind: 'ignore' };
  }
}

// --- Thin wrappers around the Tauri command surface (untested) ---------------

/** Resolve the tier's downloaded final model path (or null if not on disk). */
async function tierModelPath(tier: VoiceModelTier): Promise<string | null> {
  try {
    return (await invoke<string | null>('voice_model_path', { tier })) ?? null;
  } catch {
    return null;
  }
}

/** Resolve the bundled tiny model path (or null if the resource isn't present). */
async function bundledModelPath(): Promise<string | null> {
  try {
    return (await invoke<string | null>('voice_bundled_model_path')) ?? null;
  } catch {
    return null;
  }
}

/** Run the final, high-quality whisper pass over the full captured utterance. */
async function transcribeFinal(
  pcm: Float32Array,
  sampleRate: number,
  modelPath: string
): Promise<string> {
  // Tauri serializes a Float32Array as an array of numbers into the `Vec<f32>`.
  return invoke<string>('voice_transcribe_final', {
    pcm: Array.from(pcm),
    sampleRate,
    modelPath
  });
}

/**
 * Run a LIVE PARTIAL pass over a PCM slice via the persistent whisper-server
 * (`voice_transcribe_partial`, tiny model resident). Stateless on the Rust side —
 * it transcribes exactly the slice given; all retention state lives here. The
 * server owns the model, so no model path is passed.
 */
async function transcribePartial(pcm: Float32Array, sampleRate: number): Promise<string> {
  return invoke<string>('voice_transcribe_partial', {
    pcm: Array.from(pcm),
    sampleRate
  });
}

// --- The controller ---------------------------------------------------------

/**
 * How often the live-partials loop polls (ms). An in-flight guard means we never
 * overlap passes, so the effective rate is min(this, one whisper-server inference).
 * With the tiny model resident in the persistent server each pass is tens of ms,
 * so ~100ms keeps the overlay near real-time. The final pass on stop is
 * authoritative.
 */
const PARTIAL_INTERVAL_MS = 100;

/**
 * The trailing window (seconds) re-transcribed on EACH partial tick. Audio older
 * than this is finalized once into committed text and never reprocessed (see
 * `commitCut` + `#tickPartial`), so per-tick cost stays bounded no matter how long
 * the user talks while the overlay still shows the WHOLE message. The authoritative
 * FINAL pass (on stop) still covers the entire utterance.
 */
const REPROCESS_WINDOW_SEC = 6;

/**
 * Drives one dictation session: capture → live partials → stop&insert / cancel.
 * Construct on panel open (after `ensureModels`), call `start()`, then exactly one
 * of `stopAndInsert()` (finalize) or `cancel()` (discard). All teardown paths
 * release the microphone. Re-entrant calls are guarded so a double click / a close
 * racing a stop can't double-finalize or double-release.
 */
export class DictationPipeline {
  #capture = new MicCapture();
  #finished = false;
  // Live-partials loop state (frontend-driven; see #startPartials).
  #partialTimer: ReturnType<typeof setInterval> | null = null;
  #partialBusy = false;
  // Full-message retention: text already finalized (older than the reprocess
  // window, never re-transcribed) + how many leading PCM samples it covers. Reset
  // at the start of each session.
  #committed = '';
  #committedSamples = 0;

  /**
   * Begin capture and start the live-partials loop. Sets `recording` on success;
   * a mic-permission/start failure is surfaced by the caller (VoicePanel) which
   * awaits this and maps the rejection to the denied/error state.
   */
  async start(): Promise<void> {
    await this.#capture.start();
    voiceStore.setState('recording');
    // Reset retention state for this session, then drive live partials from the
    // frontend (full-message retention over the sliding reprocess window).
    this.#committed = '';
    this.#committedSamples = 0;
    void this.#startPartials();
  }

  /**
   * Start the live-partials loop best-effort. The persistent `whisper-server` owns
   * the (tiny) model, so there is no model-path resolution here — `#tickPartial`
   * simply calls `voice_transcribe_partial`, which lazily starts the server and
   * degrades to no-partials if it can't. A busy tick / error never disrupts
   * recording or the authoritative final pass.
   */
  async #startPartials(): Promise<void> {
    if (this.#finished) return;
    this.#partialTimer = setInterval(() => void this.#tickPartial(), PARTIAL_INTERVAL_MS);
  }

  /** Current normalized mic level (0–1) for the live waveform amplitude. */
  getLevel(): number {
    return this.#capture.getLevel();
  }

  /**
   * One partial pass with FULL-MESSAGE RETENTION over the sliding reprocess window:
   *  1. If ≥ `REPROCESS_WINDOW_SEC` of un-finalized audio has accrued, `commitCut`
   *     picks a (silence-preferring) boundary; transcribe that older slice ONCE,
   *     append it to `#committed`, and advance `#committedSamples` (never reprocessed
   *     again).
   *  2. Transcribe the trailing ≤ window slice `[committedSamples, end)` → the live
   *     `windowText`.
   *  3. Overlay = `#committed` + ' ' + `windowText`, so the WHOLE message shows while
   *     only ≤ window is reprocessed per tick.
   * In-flight guarded so passes never overlap; late results after finalize/cancel
   * are ignored. Best-effort — any error is swallowed (partials are non-authoritative).
   */
  async #tickPartial(): Promise<void> {
    if (this.#partialBusy || this.#finished) return;
    const { samples, sampleRate } = this.#capture.getPcm();
    const end = samples.length;
    if (end === 0) return;
    this.#partialBusy = true;
    try {
      // 1. Finalize audio older than the reprocess window (infrequent).
      const cut = commitCut(samples, this.#committedSamples, end, sampleRate, REPROCESS_WINDOW_SEC);
      if (cut !== null && cut > this.#committedSamples) {
        const olderText = await transcribePartial(
          samples.subarray(this.#committedSamples, cut),
          sampleRate
        );
        if (this.#finished) return;
        if (olderText.trim()) {
          this.#committed = this.#committed ? `${this.#committed} ${olderText.trim()}` : olderText.trim();
        }
        this.#committedSamples = cut;
      }

      // 2. Reprocess the trailing window.
      const windowText = await transcribePartial(
        samples.subarray(this.#committedSamples, end),
        sampleRate
      );
      // Ignore late results once we've started finalizing/cancelling.
      if (this.#finished) return;
      // 3. Overlay = committed + live window (the whole message).
      const text = `${this.#committed} ${windowText}`.trim();
      if (text) voiceStore.setPartial(text);
    } catch {
      // Partials are non-authoritative; swallow transient errors.
    } finally {
      this.#partialBusy = false;
    }
  }

  /**
   * The user's explicit "Stop & insert": finalize the utterance and insert it
   * verbatim into the focused terminal, then close the panel.
   *
   * Flow: `transcribing` state → stop capture (releases the mic) → getPcm() →
   * `voice_transcribe_final` → `finishDictation` (polish per settings + verbatim
   * insert). An empty result (no audio / VAD silence / whisper returned nothing)
   * shows a "didn't catch that" notice and keeps the panel OPEN so the user gets
   * feedback (rather than the panel silently closing with no result). Any failure
   * sets an error and does NOT throw; the panel closes only on a successful insert.
   */
  async stopAndInsert(): Promise<void> {
    // Only finalize an actual in-progress recording. If we're still requesting the
    // mic, denied, errored, or already transcribing, do nothing — a stray confirm
    // or a second activation tap in those phases must not flip state, run a final
    // pass on an empty buffer, or clobber the denied/error guidance.
    if (this.#finished || voiceStore.state !== 'recording') return;
    this.#finished = true;

    voiceStore.setState('transcribing');
    // Stop capture FIRST so the mic indicator turns off while we transcribe, and
    // grab the full utterance PCM before tearing the graph down.
    const { samples, sampleRate } = this.#capture.getPcm();
    this.#stopCapture();

    try {
      const [tierPath, tinyPath] = await Promise.all([
        tierModelPath(voice.prefs.modelTier),
        bundledModelPath()
      ]);
      const modelPath = resolveFinalModelPath(tierPath, tinyPath);
      if (!modelPath) {
        voiceStore.setError('Voice models aren’t ready yet — try again in a moment.');
        return;
      }
      if (samples.length === 0) {
        voiceStore.setError('Didn’t catch that — try again.');
        return;
      }

      const rawFinal = await transcribeFinal(samples, sampleRate, modelPath);
      if (!rawFinal.trim()) {
        // No speech recognized (silence / too quiet / too short): show a notice and
        // keep the panel open so the user knows, rather than closing with nothing.
        voiceStore.setError('Didn’t catch that — try again.');
        return;
      }

      // Polish (per settings) + verbatim insert into the focused terminal. Close
      // only on a successful insert; on `no-target` (no focused agent) or a dead
      // pane, leave the panel OPEN showing the error state so the user sees it and
      // their dictation isn't silently lost.
      const result = await finishDictation(rawFinal);
      if (result.ok) {
        voiceStore.close();
      }
      // else: insertDictation already set the error state on the store; keep open.
    } catch (e) {
      voiceStore.setError(e instanceof Error ? e.message : String(e));
      // Do NOT throw and do NOT close — leave the error visible for the user.
    }
  }

  /**
   * Discard the utterance: stop capture + release the mic, NO transcription, NO
   * insert. This is the × / Escape path. Idempotent.
   */
  cancel(): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#stopCapture();
  }

  /** Stop capture + the partials loop and release the mic. Idempotent. */
  #stopCapture(): void {
    if (this.#partialTimer) {
      clearInterval(this.#partialTimer);
      this.#partialTimer = null;
    }
    this.#capture.stop();
  }
}

// --- Active-pipeline registry (for the activation toggle) -------------------
// VoicePanel owns the live pipeline instance; the global activation handler
// (`voice://activate`) needs to reach it to finalize on a second right-⌘ tap.
// VoicePanel registers/clears the active pipeline as it opens/closes.

let activePipeline: DictationPipeline | null = null;

/** VoicePanel registers (on open) / clears (on close) the live pipeline. */
export function setActivePipeline(p: DictationPipeline | null): void {
  activePipeline = p;
}

/** The live pipeline, or null when the panel is closed. */
export function getActivePipeline(): DictationPipeline | null {
  return activePipeline;
}
