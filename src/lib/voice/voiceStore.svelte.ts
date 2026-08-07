// Reactive runes store for the voice-input PANEL — the integration backbone the
// floating VoicePanel renders and later capture/transcription slices drive. It
// holds only UI state (is the panel showing, the current phase, the live partial
// + committed transcripts, any error), kept as a singleton so the mic button and
// the panel share one instance without prop-drilling. ALL transition logic lives
// in small pure methods so it's unit-testable WITHOUT a DOM.
//
// NOTE: named `voiceStore.svelte.ts` (not `voice.svelte.ts`) to avoid colliding
// with the voice-SETTINGS store at `$lib/settings/voice.svelte`.

/** The voice capture/transcription phase reflected by the panel. */
export type VoiceState =
  | 'idle'
  | 'requesting'
  | 'denied'
  | 'recording'
  | 'transcribing'
  | 'error';

/** The reactive voice-panel store. A single instance is exported below. */
export class VoiceStore {
  /** Whether the floating voice panel is currently shown. */
  open = $state(false);

  /** The current capture/transcription phase. */
  state = $state<VoiceState>('idle');

  /** Live, in-progress (provisional) transcript shown distinct from final text. */
  partial = $state('');

  /** Committed (final) transcript text. */
  finalText = $state('');

  /** Last error message, or null when none. */
  error = $state<string | null>(null);

  /**
   * Monotonic CAPTURE-SESSION id, bumped by BOTH `show()` and `retry()` — every
   * distinct capture gets its own value.
   *
   * VoicePanel's pipeline `$effect` reads it, so bumping it tears the current
   * `DictationPipeline` down and builds a fresh one WITHOUT closing the panel.
   * That is what makes in-place `retry()` work: a pipeline that has finalized or
   * failed is `#finished` and has released the mic, so recovering needs a NEW
   * pipeline, not a nudge to the old one.
   *
   * It is also the STALENESS FENCE for slow async work. `DictationPipeline`'s
   * `#finished` flag is per-instance, but this store is a singleton — so a final
   * pass still in flight from an abandoned session would otherwise write its
   * result (or insert its text, or close the panel) over whatever session is live
   * now. Long-running work snapshots this id and re-checks it after each await.
   */
  session = $state(0);

  /** Open the panel, resetting transient state. Single instance: if already
   *  open this is a NO-OP so a stray second call can't wipe an in-progress
   *  partial/state mid-capture. */
  show(): void {
    if (this.open) return;
    this.open = true;
    this.state = 'idle';
    this.partial = '';
    this.finalText = '';
    this.error = null;
    this.session += 1;
  }

  /** Close the panel and reset UI state. (Later slices also stop capture here
   *  via a hook; for now this just resets the visible state.) */
  close(): void {
    this.open = false;
    this.state = 'idle';
    this.partial = '';
  }

  /** Set the live (provisional) transcript. */
  setPartial(t: string): void {
    this.partial = t;
  }

  /** Set the committed (final) transcript. */
  setFinal(t: string): void {
    this.finalText = t;
  }

  /** Set the capture/transcription phase. */
  setState(s: VoiceState): void {
    this.state = s;
  }

  /**
   * Record an error message and move to a failure phase.
   *
   * `phase` defaults to `'error'` (the generic failure). Pass `'denied'` for a
   * blocked microphone so the panel keeps rendering the denied-specific System
   * Settings guidance — this used to be a `setState('denied')` followed by a
   * `setError()` that immediately clobbered it back to `'error'`, which silently
   * hid that hint.
   */
  setError(msg: string, phase: 'error' | 'denied' = 'error'): void {
    this.error = msg;
    this.state = phase;
  }

  /**
   * Recover from a failed/denied attempt IN PLACE, without closing the panel:
   * clear the error, return to `idle`, and bump `session` so VoicePanel discards
   * the spent pipeline and starts a fresh capture.
   *
   * This is the escape hatch from the failure phases — the guidance block's
   * "Try again" control and a right-⌘ tap while errored both land here. A no-op
   * while closed, so a stray call can never resurrect a dismissed panel.
   *
   * `finalText` is deliberately PRESERVED. Some failures happen AFTER a successful
   * transcription — a dead pane or no focused agent means the insert failed, not
   * the dictation — and the pipeline keeps the panel open precisely so that text
   * isn't silently lost. Wiping it here would destroy a finished transcript on the
   * panel's most inviting control. The live `partial` IS cleared: it belongs to the
   * capture being abandoned.
   */
  retry(): void {
    if (!this.open) return;
    this.state = 'idle';
    this.error = null;
    this.partial = '';
    this.session += 1;
  }
}

/** The singleton voice-panel store, imported by the mic button + VoicePanel. */
export const voiceStore = new VoiceStore();
