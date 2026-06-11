// Auto-advance preference: whether focus automatically advances to the next
// "Needs input" agent after the existing grace delay when the current agent
// leaves the attention state. Stored as the `autoAdvance` slice of the shared
// `settings.json` blob; like voice, it loads once on startup and saves
// (best-effort, merge-aware) on every change so it never clobbers sibling
// slices. The pure `parseAutoAdvancePrefs` validator is unit-tested. DEFAULTS
// TO OFF — out of the box, focus never auto-advances.

import { loadSettings, saveSettingsSlice } from './persist';

/** Auto-advance preference. */
export interface AutoAdvancePrefs {
  enabled: boolean;
}

/** Defaults for a fresh install: auto-advance OFF. */
export const DEFAULT_AUTO_ADVANCE_PREFS: AutoAdvancePrefs = {
  enabled: false
};

/** PURE: validate/normalize the persisted `autoAdvance` slice into a fully-
 *  defaulted `AutoAdvancePrefs`. Tolerates any shape — non-objects, missing
 *  fields, and wrong types fall back to `DEFAULT_AUTO_ADVANCE_PREFS` (OFF). */
export function parseAutoAdvancePrefs(raw: unknown): AutoAdvancePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_AUTO_ADVANCE_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;
  return {
    enabled: bool(obj.enabled, DEFAULT_AUTO_ADVANCE_PREFS.enabled)
  };
}

/**
 * Reactive auto-advance settings store. Singleton, imported by the settings
 * modal (read/write) and the inbox advance effect (read).
 */
export class AutoAdvanceStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<AutoAdvancePrefs>({ ...DEFAULT_AUTO_ADVANCE_PREFS });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** Load persisted prefs from the shared settings blob's `autoAdvance` slice.
   *  On a fresh install the `DEFAULT_AUTO_ADVANCE_PREFS` apply (OFF). Never
   *  throws. Call once on mount. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    this.prefs = parseAutoAdvancePrefs(settings.autoAdvance);
    this.loaded = true;
  }

  /** Enable/disable auto-advance and persist (best-effort). */
  setEnabled(enabled: boolean): void {
    this.prefs = { ...this.prefs, enabled };
    void this.save();
  }

  /** Persist the current prefs as the `autoAdvance` slice, merging into the
   *  shared settings blob so sibling slices (e.g. voice) are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('autoAdvance', this.prefs);
  }
}

/** The singleton auto-advance store. */
export const autoAdvance = new AutoAdvanceStore();
