// Limit-reset countdown preference: whether the footer shows a live countdown to
// the next account rate-limit reset (the soonest of the 5-hour / 7-day windows),
// rendered as a text metric beside the "time since last message" one. Stored as
// the `limitReset` slice of the shared `settings.json` blob; like the other
// settings stores it loads once on startup and saves (best-effort, merge-aware)
// on every change so it never clobbers sibling slices. The pure
// `parseLimitResetPrefs` validator is unit-tested. DEFAULTS TO OFF — out of the
// box the footer does not show the reset countdown.

import { loadSettings, saveSettingsSlice } from './persist';

/** Limit-reset countdown preference. */
export interface LimitResetPrefs {
  enabled: boolean;
}

/** Defaults for a fresh install: the countdown is OFF. */
export const DEFAULT_LIMIT_RESET_PREFS: LimitResetPrefs = {
  enabled: false
};

/** PURE: validate/normalize the persisted `limitReset` slice into a fully-
 *  defaulted `LimitResetPrefs`. Tolerates any shape — non-objects, missing
 *  fields, and wrong types fall back to `DEFAULT_LIMIT_RESET_PREFS` (OFF). */
export function parseLimitResetPrefs(raw: unknown): LimitResetPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_LIMIT_RESET_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;
  return {
    enabled: bool(obj.enabled, DEFAULT_LIMIT_RESET_PREFS.enabled)
  };
}

/**
 * Reactive limit-reset settings store. Singleton, imported by the settings modal
 * (read/write) and the app footer (read).
 */
export class LimitResetStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<LimitResetPrefs>({ ...DEFAULT_LIMIT_RESET_PREFS });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** Load persisted prefs from the shared settings blob's `limitReset` slice.
   *  On a fresh install the `DEFAULT_LIMIT_RESET_PREFS` apply (OFF). Never
   *  throws. Call once on mount. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    this.prefs = parseLimitResetPrefs(settings.limitReset);
    this.loaded = true;
  }

  /** Enable/disable the footer reset countdown and persist (best-effort). */
  setEnabled(enabled: boolean): void {
    this.prefs = { ...this.prefs, enabled };
    void this.save();
  }

  /** Persist the current prefs as the `limitReset` slice, merging into the
   *  shared settings blob so sibling slices are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('limitReset', this.prefs);
  }
}

/** The singleton limit-reset store. */
export const limitReset = new LimitResetStore();
