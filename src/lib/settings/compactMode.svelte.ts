// Compact-mode preference: when enabled, the sessions panel (Inbox roster rows)
// is condensed by dropping each row's third content line — the `.meta` line
// carrying context %, model, and last-activity time — leaving just the title and
// subtitle. Stored as the `compactMode` slice of the shared `settings.json` blob;
// like the other settings stores it loads once on startup and saves
// (best-effort, merge-aware) on every change so it never clobbers sibling slices.
// The pure `parseCompactModePrefs` validator is unit-tested. DEFAULTS TO OFF —
// out of the box, rows show all three lines.

import { loadSettings, saveSettingsSlice } from './persist';

/** Compact-mode preference. */
export interface CompactModePrefs {
  enabled: boolean;
}

/** Defaults for a fresh install: compact mode OFF (full three-line rows). */
export const DEFAULT_COMPACT_MODE_PREFS: CompactModePrefs = {
  enabled: false
};

/** PURE: validate/normalize the persisted `compactMode` slice into a fully-
 *  defaulted `CompactModePrefs`. Tolerates any shape — non-objects, missing
 *  fields, and wrong types fall back to `DEFAULT_COMPACT_MODE_PREFS` (OFF). */
export function parseCompactModePrefs(raw: unknown): CompactModePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_COMPACT_MODE_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;
  return {
    enabled: bool(obj.enabled, DEFAULT_COMPACT_MODE_PREFS.enabled)
  };
}

/**
 * Reactive compact-mode settings store. Singleton, imported by the settings
 * modal (read/write) and the inbox roster (read).
 */
export class CompactModeStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<CompactModePrefs>({ ...DEFAULT_COMPACT_MODE_PREFS });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** Load persisted prefs from the shared settings blob's `compactMode` slice.
   *  On a fresh install the `DEFAULT_COMPACT_MODE_PREFS` apply (OFF). Never
   *  throws. Call once on mount. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    this.prefs = parseCompactModePrefs(settings.compactMode);
    this.loaded = true;
  }

  /** Enable/disable compact mode and persist (best-effort). */
  setEnabled(enabled: boolean): void {
    this.prefs = { ...this.prefs, enabled };
    void this.save();
  }

  /** Persist the current prefs as the `compactMode` slice, merging into the
   *  shared settings blob so sibling slices are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('compactMode', this.prefs);
  }
}

/** The singleton compact-mode store. */
export const compactMode = new CompactModeStore();
