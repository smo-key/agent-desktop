// Subagents-visibility preference: whether the Sessions panel nests each agent's
// live subagents under its row. Stored as the `subagentsVisible` slice of the
// shared `settings.json` blob; like the sibling prefs it loads once on startup and
// saves (best-effort, merge-aware) on every change so it never clobbers other
// slices. The pure `parseSubagentsVisiblePrefs` validator is unit-tested. DEFAULTS
// TO ON — out of the box, subagents are shown.

import { loadSettings, saveSettingsSlice } from './persist';

/** Subagents-visibility preference. */
export interface SubagentsVisiblePrefs {
  enabled: boolean;
}

/** Defaults for a fresh install: subagents SHOWN. */
export const DEFAULT_SUBAGENTS_VISIBLE_PREFS: SubagentsVisiblePrefs = {
  enabled: true
};

/** PURE: validate/normalize the persisted `subagentsVisible` slice into a fully-
 *  defaulted `SubagentsVisiblePrefs`. Tolerates any shape — non-objects, missing
 *  fields, and wrong types fall back to `DEFAULT_SUBAGENTS_VISIBLE_PREFS` (ON). */
export function parseSubagentsVisiblePrefs(raw: unknown): SubagentsVisiblePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_SUBAGENTS_VISIBLE_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;
  return {
    enabled: bool(obj.enabled, DEFAULT_SUBAGENTS_VISIBLE_PREFS.enabled)
  };
}

/**
 * Reactive subagents-visibility store. Singleton, imported by the settings modal
 * (read/write) and the Inbox (read — gates the nested subagent rows).
 */
export class SubagentsVisibleStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<SubagentsVisiblePrefs>({ ...DEFAULT_SUBAGENTS_VISIBLE_PREFS });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** Load persisted prefs from the shared settings blob's `subagentsVisible`
   *  slice. On a fresh install the `DEFAULT_SUBAGENTS_VISIBLE_PREFS` apply (ON).
   *  Never throws. Call once on mount. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    this.prefs = parseSubagentsVisiblePrefs(settings.subagentsVisible);
    this.loaded = true;
  }

  /** Show/hide subagents and persist (best-effort). */
  setEnabled(enabled: boolean): void {
    this.prefs = { ...this.prefs, enabled };
    void this.save();
  }

  /** Persist the current prefs as the `subagentsVisible` slice, merging into the
   *  shared settings blob so sibling slices are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('subagentsVisible', this.prefs);
  }
}

/** The singleton subagents-visibility store. */
export const subagentsVisible = new SubagentsVisibleStore();
