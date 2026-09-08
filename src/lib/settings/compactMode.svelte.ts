// Sessions-panel density preference. Three levels, each dropping more of a
// roster row (the Inbox session rows, one per open agent window):
//   - `default`: title, status sub-line, and the `.meta` line (context %, model,
//     last-activity time).
//   - `compact`: drops the `.meta` line, leaving title + sub-line.
//   - `minimal`: keeps ONLY the title, next to a smaller project icon.
// Stored as the `compactMode` slice of the shared `settings.json` blob (the slice
// name predates the third level; it used to be a single `enabled` boolean, which
// `parseCompactModePrefs` still migrates). Like the other settings stores it
// loads once on startup and saves (best-effort, merge-aware) on every change so
// it never clobbers sibling slices. DEFAULTS TO `default` — out of the box, rows
// show all three lines.

import { loadSettings, saveSettingsSlice } from './persist';

/** The roster-row density levels, least to most condensed. */
export const DENSITIES = ['default', 'compact', 'minimal'] as const;
export type Density = (typeof DENSITIES)[number];

/** Sessions-panel density preference. */
export interface CompactModePrefs {
  density: Density;
}

/** Defaults for a fresh install: full three-line rows. */
export const DEFAULT_COMPACT_MODE_PREFS: CompactModePrefs = {
  density: 'default'
};

function isDensity(v: unknown): v is Density {
  return typeof v === 'string' && (DENSITIES as readonly string[]).includes(v);
}

/** PURE: validate/normalize the persisted `compactMode` slice into a fully-
 *  defaulted `CompactModePrefs`. Tolerates any shape — non-objects, missing
 *  fields, and wrong types fall back to `DEFAULT_COMPACT_MODE_PREFS`. A legacy
 *  `{ enabled: true }` slice (the pre-density boolean) reads as `compact`; a
 *  present, valid `density` always wins over the legacy flag. */
export function parseCompactModePrefs(raw: unknown): CompactModePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_COMPACT_MODE_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  if (isDensity(obj.density)) return { density: obj.density };
  if (obj.enabled === true) return { density: 'compact' };
  return { ...DEFAULT_COMPACT_MODE_PREFS };
}

/**
 * Reactive density settings store. Singleton, imported by the settings modal
 * (read/write) and the inbox roster (read).
 */
export class CompactModeStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<CompactModePrefs>({ ...DEFAULT_COMPACT_MODE_PREFS });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** True when the `.meta` line should be hidden (compact OR minimal). */
  get enabled(): boolean {
    return this.prefs.density !== 'default';
  }

  /** True when rows should collapse to just the title + a smaller icon. */
  get minimal(): boolean {
    return this.prefs.density === 'minimal';
  }

  /** Load persisted prefs from the shared settings blob's `compactMode` slice.
   *  On a fresh install the `DEFAULT_COMPACT_MODE_PREFS` apply. Never throws.
   *  Call once on mount. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    this.prefs = parseCompactModePrefs(settings.compactMode);
    this.loaded = true;
  }

  /** Set the density and persist (best-effort). Unknown values are ignored. */
  setDensity(density: Density): void {
    if (!isDensity(density)) return;
    this.prefs = { ...this.prefs, density };
    void this.save();
  }

  /** Persist the current prefs as the `compactMode` slice, merging into the
   *  shared settings blob so sibling slices are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('compactMode', this.prefs);
  }
}

/** The singleton density store. */
export const compactMode = new CompactModeStore();
