// KEEP-AWAKE preference — whether the app holds a system idle-sleep inhibitor so
// the computer does not doze off while agents are working. When the machine
// idle-sleeps, the agents' long-lived network connections (API streams, MCP
// servers, SSH tunnels) die and the sessions stall or error out. Modes:
//   - `never` (default): the app never inhibits sleep.
//   - `agent-running`:   inhibit only while at least one agent is In flight.
//   - `app-open`:        inhibit for as long as the app is running.
// The host side (Tauri) owns the actual inhibitor handle; this store only holds
// the preference and the PURE `shouldKeepAwake` policy that decides whether the
// handle should be held right now. Stored as the `keepAwake` slice of the shared
// `settings.json` blob (never localStorage). Like the other settings stores it
// loads once on startup and saves (best-effort, merge-aware) on every change so
// it never clobbers sibling slices.

import { loadSettings, saveSettingsSlice } from './persist';

/** The keep-awake modes, in the order Settings offers them. */
export const KEEP_AWAKE_MODES = ['never', 'agent-running', 'app-open'] as const;
export type KeepAwakeMode = (typeof KEEP_AWAKE_MODES)[number];

/** Keep-awake preference. */
export interface KeepAwakePrefs {
  mode: KeepAwakeMode;
}

/** Defaults for a fresh install: never inhibit sleep. */
export const DEFAULT_KEEP_AWAKE_PREFS: KeepAwakePrefs = {
  mode: 'never'
};

function isMode(v: unknown): v is KeepAwakeMode {
  return typeof v === 'string' && (KEEP_AWAKE_MODES as readonly string[]).includes(v);
}

/** PURE: validate/normalize the persisted `keepAwake` slice into a fully-
 *  defaulted `KeepAwakePrefs`. Tolerates any shape — non-objects, arrays,
 *  missing fields, wrong types, and unknown modes fall back to `never`. */
export function parseKeepAwakePrefs(raw: unknown): KeepAwakePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_KEEP_AWAKE_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  if (isMode(obj.mode)) return { mode: obj.mode };
  return { ...DEFAULT_KEEP_AWAKE_PREFS };
}

/** PURE: should the idle-sleep inhibitor be held right now, given the selected
 *  mode and whether any agent is currently working (In flight)? */
export function shouldKeepAwake(mode: KeepAwakeMode, anyAgentWorking: boolean): boolean {
  switch (mode) {
    case 'never':
      return false;
    case 'app-open':
      return true;
    case 'agent-running':
      return anyAgentWorking;
    default:
      return false;
  }
}

/**
 * Reactive keep-awake settings store. Singleton, imported by the settings modal
 * (read/write) and the inhibitor controller (read).
 */
export class KeepAwakeStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<KeepAwakePrefs>({ ...DEFAULT_KEEP_AWAKE_PREFS });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** The selected keep-awake mode. */
  get mode(): KeepAwakeMode {
    return this.prefs.mode;
  }

  /** Load persisted prefs from the shared settings blob's `keepAwake` slice.
   *  On a fresh install the defaults apply. Never throws. Call once on mount. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    this.prefs = parseKeepAwakePrefs(settings.keepAwake);
    this.loaded = true;
  }

  /** Set the keep-awake mode and persist (best-effort). Unknown values are ignored. */
  setMode(mode: KeepAwakeMode): void {
    if (!isMode(mode)) return;
    this.prefs = { ...this.prefs, mode };
    void this.save();
  }

  /** Persist the current prefs as the `keepAwake` slice, merging into the
   *  shared settings blob so sibling slices are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('keepAwake', this.prefs);
  }
}

/** The singleton keep-awake store. */
export const keepAwake = new KeepAwakeStore();
