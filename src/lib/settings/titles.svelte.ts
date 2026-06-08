// Session-title preferences. Currently a single opt-in: `cloudFallback` — when the
// on-device title model is unavailable, allow regenerating the title with the cloud
// `claude -p` (Haiku) fallback (see src-tauri `session_focus` / `claude_title.rs`).
// Stored as the `titles` slice of the shared `settings.json` blob; like the voice
// slice it loads once on startup and saves (best-effort, merge-aware) on every
// change so it never clobbers sibling slices. The pure `parseTitlePrefs` validator
// is unit-tested.

import { loadSettings, saveSettingsSlice } from './persist';

/** Session-title preferences. */
export interface TitlePrefs {
  cloudFallback: boolean;
}

/** Defaults: cloud fallback OFF, so titles stay on-device only unless the user
 *  opts in (preserves the original on-device-only privacy posture). */
export const DEFAULT_TITLE_PREFS: TitlePrefs = {
  cloudFallback: false
};

/** PURE: validate/normalize the persisted `titles` slice into a fully-defaulted
 *  `TitlePrefs`. Tolerates any shape — non-objects, missing fields, and wrong
 *  types fall back to `DEFAULT_TITLE_PREFS`. */
export function parseTitlePrefs(raw: unknown): TitlePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_TITLE_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;
  return {
    cloudFallback: bool(obj.cloudFallback, DEFAULT_TITLE_PREFS.cloudFallback)
  };
}

/**
 * Reactive session-title settings store. Singleton, imported by the settings modal
 * (read/write) and the overview title store (read, to pass `cloudFallback` to
 * `session_focus`).
 */
export class TitleSettingsStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<TitlePrefs>({ ...DEFAULT_TITLE_PREFS });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** Load persisted prefs from the shared settings blob's `titles` slice. On a
   *  fresh install the `DEFAULT_TITLE_PREFS` apply. Never throws. Call once on
   *  mount. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    this.prefs = parseTitlePrefs(settings.titles);
    this.loaded = true;
  }

  /** Toggle the cloud title fallback and persist (best-effort). */
  setCloudFallback(cloudFallback: boolean): void {
    this.prefs = { ...this.prefs, cloudFallback };
    void this.save();
  }

  /** Persist the current prefs as the `titles` slice, merging into the shared
   *  settings blob so sibling slices (voice, openWith) are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('titles', this.prefs);
  }
}

/** The singleton session-title settings store. */
export const titleSettings = new TitleSettingsStore();
