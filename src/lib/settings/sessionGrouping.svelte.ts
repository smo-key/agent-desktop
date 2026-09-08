// Sessions-panel GROUPING preference — how the Inbox roster sections its live
// sessions (agent-roster-display: "The roster grouping is user-selectable"):
//   - `status` (default): the Needs you / In flight / Paused lanes, as always.
//   - `date`:   Today / Yesterday / Last 7 days / Older by last activity.
//   - `none`:   one flat list, newest activity first, no headers.
// Pinned sessions always lead and archived sessions always trail regardless of
// the mode — the mode only shapes the body between them (see overview/grouping).
// Stored as the `sessionGrouping` slice of the shared `settings.json` blob. Like
// the other settings stores it loads once on startup and saves (best-effort,
// merge-aware) on every change so it never clobbers sibling slices.

import { loadSettings, saveSettingsSlice } from './persist';

/** The roster grouping modes, in the order Settings offers them. */
export const GROUPING_MODES = ['status', 'date', 'none'] as const;
export type GroupingMode = (typeof GROUPING_MODES)[number];

/** Sessions-panel grouping preference. */
export interface SessionGroupingPrefs {
  mode: GroupingMode;
}

/** Defaults for a fresh install: grouped by status (the classic lanes). */
export const DEFAULT_SESSION_GROUPING_PREFS: SessionGroupingPrefs = {
  mode: 'status'
};

function isMode(v: unknown): v is GroupingMode {
  return typeof v === 'string' && (GROUPING_MODES as readonly string[]).includes(v);
}

/** PURE: validate/normalize the persisted `sessionGrouping` slice into a fully-
 *  defaulted `SessionGroupingPrefs`. Tolerates any shape — non-objects, missing
 *  fields, wrong types, and unknown modes fall back to `status`. */
export function parseSessionGroupingPrefs(raw: unknown): SessionGroupingPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_SESSION_GROUPING_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  if (isMode(obj.mode)) return { mode: obj.mode };
  return { ...DEFAULT_SESSION_GROUPING_PREFS };
}

/**
 * Reactive grouping settings store. Singleton, imported by the settings modal
 * (read/write) and the inbox roster (read).
 */
export class SessionGroupingStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<SessionGroupingPrefs>({ ...DEFAULT_SESSION_GROUPING_PREFS });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** The selected grouping mode. */
  get mode(): GroupingMode {
    return this.prefs.mode;
  }

  /** Load persisted prefs from the shared settings blob's `sessionGrouping`
   *  slice. On a fresh install the defaults apply. Never throws. Call once on
   *  mount. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    this.prefs = parseSessionGroupingPrefs(settings.sessionGrouping);
    this.loaded = true;
  }

  /** Set the grouping mode and persist (best-effort). Unknown values are ignored. */
  setMode(mode: GroupingMode): void {
    if (!isMode(mode)) return;
    this.prefs = { ...this.prefs, mode };
    void this.save();
  }

  /** Persist the current prefs as the `sessionGrouping` slice, merging into the
   *  shared settings blob so sibling slices are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('sessionGrouping', this.prefs);
  }
}

/** The singleton grouping store. */
export const sessionGrouping = new SessionGroupingStore();
