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
// MANUAL (tasks 9.1/9.2): this assembly COMPILES and is logically wired, but it
// only RUNS end-to-end with the provisioned whisper/llama sidecars + models on
// disk + a real microphone. The live STT stream loop is itself a Rust stub today
// (task 4.3), so live partials receive nothing until that lands — the wiring is
// correct and compiles regardless.

import { Channel, invoke } from '@tauri-apps/api/core';
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
 * Drives one dictation session: capture → live partials → stop&insert / cancel.
 * Construct on panel open (after `ensureModels`), call `start()`, then exactly one
 * of `stopAndInsert()` (finalize) or `cancel()` (discard). All teardown paths
 * release the microphone. Re-entrant calls are guarded so a double click / a close
 * racing a stop can't double-finalize or double-release.
 */
export class DictationPipeline {
  #capture = new MicCapture();
  #channel: Channel<TranscribeEvent> | null = null;
  #finished = false;

  /**
   * Begin capture and wire the live-partials stream. Sets `recording` on success;
   * on a mic-permission/start failure surfaces the error on the store and does NOT
   * proceed (mirrors the panel's prior capture handling). The live stream loop is
   * a Rust stub today, so partials simply won't arrive until task 4.3/9.1 — the
   * wiring is correct and compiles.
   */
  async start(): Promise<void> {
    await this.#capture.start();
    voiceStore.setState('recording');

    // Subscribe to live partials. The Rust `voice_transcribe_stream` is a stub
    // (sends nothing yet), so this receives no events live — but the contract is
    // fully wired and type-checked.
    const channel = new Channel<TranscribeEvent>();
    channel.onmessage = (ev) => {
      const effect = reduceTranscribeEvent(ev);
      if (effect.kind === 'partial') voiceStore.setPartial(effect.text);
      else if (effect.kind === 'error') voiceStore.setError(effect.message);
    };
    this.#channel = channel;

    // Resolve the live/streaming model path (prefer tier model, else bundled tiny)
    // and open the stream. Best-effort: a stub/absent stream must not break record.
    void this.#startStream(channel);
  }

  /** Open the live-partials stream with a resolved model path. Best-effort. */
  async #startStream(channel: Channel<TranscribeEvent>): Promise<void> {
    try {
      const [tierPath, tinyPath] = await Promise.all([
        tierModelPath(voice.prefs.modelTier),
        bundledModelPath()
      ]);
      const modelPath = resolveFinalModelPath(tierPath, tinyPath);
      if (!modelPath) return; // no model on disk — final pass also degrades.
      await invoke('voice_transcribe_stream', { onEvent: channel, modelPath });
      // MANUAL: real-time loop (task 4.3/9.1) — the Rust command is a stub that
      // returns immediately and streams nothing; PCM is not yet fed to it.
    } catch {
      // A missing binary / stub returning early must not surface as a hard error
      // during recording; the final pass is the authoritative transcription.
    }
  }

  /**
   * The user's explicit "Stop & insert": finalize the utterance and insert it
   * verbatim into the focused terminal, then close the panel.
   *
   * Flow: `transcribing` state → stop capture (releases the mic) → getPcm() →
   * `voice_transcribe_final` → `finishDictation` (polish per settings + verbatim
   * insert). An empty result (VAD silence → "") inserts nothing and returns the
   * panel to `idle` ("didn't catch that"), never an error. Any failure sets an
   * error on the store and does NOT throw. The panel is closed at the end.
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
      if (!modelPath || samples.length === 0) {
        // No model on disk, or no audio captured: nothing to transcribe. Treat as
        // "didn't catch that" rather than an error.
        voiceStore.setState('idle');
        voiceStore.close();
        return;
      }

      const rawFinal = await transcribeFinal(samples, sampleRate, modelPath);
      if (!rawFinal.trim()) {
        // VAD silence / no speech → no insertion, no error (spec: silence produces
        // no text). Show idle "didn't catch that", then close.
        voiceStore.setState('idle');
        voiceStore.close();
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

  /** Stop capture, release the mic, and drop the live stream channel. Idempotent. */
  #stopCapture(): void {
    this.#capture.stop();
    // Dropping the reference lets the channel be GC'd; the Rust stub stream has
    // already returned, so there is no long-lived task to cancel.
    this.#channel = null;
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
