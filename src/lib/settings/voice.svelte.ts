// Voice-input preferences: whether voice capture is enabled, whether to "polish"
// (clean up) the raw transcript, and which transcription model tier to use. Stored
// as the `voice` slice of the shared `settings.json` blob; like open-with, it loads
// once on startup and saves (best-effort, merge-aware) on every change so it never
// clobbers sibling slices. The pure `parseVoicePrefs` validator is unit-tested.

import { loadSettings, saveSettingsSlice } from './persist';

/** Transcription model tier: `fast` (small, lower latency) or `accurate` (large). */
export type VoiceModelTier = 'fast' | 'accurate';

/** Voice-input preferences. */
export interface VoicePrefs {
  enabled: boolean;
  polish: boolean;
  modelTier: VoiceModelTier;
}

/** Defaults for a fresh install: voice on, polish on, accurate transcription. */
export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  enabled: true,
  polish: true,
  modelTier: 'accurate'
};

/** The valid model tiers, for validation. */
const MODEL_TIERS: readonly VoiceModelTier[] = ['fast', 'accurate'];

/** PURE: validate/normalize the persisted `voice` slice into a fully-defaulted
 *  `VoicePrefs`. Tolerates any shape — non-objects, missing fields, and wrong types
 *  fall back to `DEFAULT_VOICE_PREFS`; `modelTier` outside the union → 'accurate'. */
export function parseVoicePrefs(raw: unknown): VoicePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_VOICE_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;
  const tier = (v: unknown): VoiceModelTier =>
    MODEL_TIERS.includes(v as VoiceModelTier)
      ? (v as VoiceModelTier)
      : DEFAULT_VOICE_PREFS.modelTier;
  return {
    enabled: bool(obj.enabled, DEFAULT_VOICE_PREFS.enabled),
    polish: bool(obj.polish, DEFAULT_VOICE_PREFS.polish),
    modelTier: tier(obj.modelTier)
  };
}

/**
 * Reactive voice-settings store. Singleton, imported by the settings modal
 * (read/write) and the voice-input pipeline (read).
 */
export class VoiceStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<VoicePrefs>({ ...DEFAULT_VOICE_PREFS });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** Load persisted prefs from the shared settings blob's `voice` slice. On a
   *  fresh install the `DEFAULT_VOICE_PREFS` apply. Never throws. Call once on
   *  mount. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    this.prefs = parseVoicePrefs(settings.voice);
    this.loaded = true;
  }

  /** Enable/disable voice input and persist (best-effort). */
  setEnabled(enabled: boolean): void {
    this.prefs = { ...this.prefs, enabled };
    void this.save();
  }

  /** Toggle transcript polishing and persist (best-effort). */
  setPolish(polish: boolean): void {
    this.prefs = { ...this.prefs, polish };
    void this.save();
  }

  /** Set the transcription model tier and persist (best-effort). */
  setModelTier(modelTier: VoiceModelTier): void {
    this.prefs = { ...this.prefs, modelTier };
    void this.save();
  }

  /** Persist the current prefs as the `voice` slice, merging into the shared
   *  settings blob so sibling slices (e.g. openWith) are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('voice', this.prefs);
  }
}

/** The singleton voice store. */
export const voice = new VoiceStore();
