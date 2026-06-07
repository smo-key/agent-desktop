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

  /** Record an error message and force the phase to `error`. */
  setError(msg: string): void {
    this.error = msg;
    this.state = 'error';
  }
}

/** The singleton voice-panel store, imported by the mic button + VoicePanel. */
export const voiceStore = new VoiceStore();
