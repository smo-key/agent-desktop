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
//   - cancel(): the × button, Escape, or a click on the scrim. DISCARDS the
//     utterance: stop capture + release the mic, NO transcription, NO insert.
//
// Pure/testable bits live in small exported functions (model-path resolution, the
// partial-event reducer); `invoke`, `Channel`, `MicCapture`, and the DOM stay in
// thin, untested wrappers below.
//
// Live partials are driven from the frontend: a ~600ms interval re-transcribes the
// audio-so-far with the fast tiny model and shows it as the provisional overlay
// (Whisper isn't natively streaming, so a rolling re-transcribe is the practical
// approach). The final pass uses the tier model. Both reuse the one Tauri
// `voice_transcribe_final` command, so there is no separate Rust streaming loop.
//
// Runs end-to-end once the whisper sidecar + a model are provisioned (the bundled
// tiny model is used for partials); polish additionally needs the llama-server.

import { invoke } from '@tauri-apps/api/core';
import { voice } from '$lib/settings/voice.svelte';
import { MicCapture } from './capture';
import { finishDictation } from './polish';
import { voiceStore } from './voiceStore.svelte';
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

// --- The controller ---------------------------------------------------------

/**
 * How often the live-partials loop polls to re-transcribe the audio-so-far (ms).
 * An in-flight guard means we never overlap passes, so the effective rate is
 * min(this, one whisper pass) — with the per-call model reload of the one-shot
 * CLI this is the practical floor. The final pass on stop is authoritative.
 */
const PARTIAL_INTERVAL_MS = 200;

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
  #partialModel: string | null = null;

  /**
   * Begin capture and start the live-partials loop. Sets `recording` on success;
   * a mic-permission/start failure is surfaced by the caller (VoicePanel) which
   * awaits this and maps the rejection to the denied/error state.
   */
  async start(): Promise<void> {
    await this.#capture.start();
    voiceStore.setState('recording');
    // Drive live partials from the frontend: periodically re-transcribe the
    // audio-so-far with the FAST tiny model and show it as the provisional overlay.
    void this.#startPartials();
  }

  /**
   * Live partials: every ~600ms re-transcribe the audio captured so far with the
   * fast tiny model (Whisper isn't natively streaming, so a rolling re-transcribe
   * of the growing buffer is the practical "what I'm saying" overlay). Each pass
   * supersedes the previous partial. Best-effort: a missing model / busy tick /
   * transcription error never disrupts recording; the final pass is authoritative.
   */
  async #startPartials(): Promise<void> {
    // Prefer the bundled tiny model for partials (fastest); fall back to the tier
    // model if tiny isn't present.
    const [tinyPath, tierPath] = await Promise.all([
      bundledModelPath(),
      tierModelPath(voice.prefs.modelTier)
    ]);
    this.#partialModel = tinyPath ?? tierPath;
    if (!this.#partialModel || this.#finished) return;
    this.#partialTimer = setInterval(() => void this.#tickPartial(), PARTIAL_INTERVAL_MS);
  }

  /** Current normalized mic level (0–1) for the live waveform amplitude. */
  getLevel(): number {
    return this.#capture.getLevel();
  }

  /** One partial pass: transcribe the buffer-so-far → update the overlay. */
  async #tickPartial(): Promise<void> {
    if (this.#partialBusy || this.#finished || !this.#partialModel) return;
    const { samples, sampleRate } = this.#capture.getPcm();
    if (samples.length === 0) return;
    this.#partialBusy = true;
    try {
      const text = await transcribeFinal(samples, sampleRate, this.#partialModel);
      // Ignore late results once we've started finalizing/cancelling.
      if (!this.#finished && text.trim()) voiceStore.setPartial(text);
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
    if (this.#finished) return;
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
   * insert. This is the × / Escape / click-outside path. Idempotent.
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
