// Theme preference: dark / light / system. Stored as the `theme` slice of the
// shared `settings.json` blob; like the other settings stores it loads once on
// startup and saves (best-effort, merge-aware) on every change so it never
// clobbers sibling slices. The pure `parseThemePrefs` validator is unit-tested.
// DEFAULTS TO 'dark' — a first run must render exactly like the app always has,
// no surprise flip to a system light preference (see design D1/S1).
//
// `resolved` is the derived 'dark' | 'light' the rest of the app actually reacts
// to: for 'dark'/'light' it's the mode itself; for 'system' it follows a live
// `matchMedia('(prefers-color-scheme: dark)')` listener. `+layout.svelte` reads
// `resolved` in an `$effect` and stamps it onto `<html data-theme=...>`, which is
// the attribute selector `tokens.css`'s `:root[data-theme='...']` blocks match.

import { loadSettings, saveSettingsSlice } from './persist';

/** Theme mode as persisted/selected by the user. */
export type ThemeMode = 'dark' | 'light' | 'system';

/** Theme preference. */
export interface ThemePrefs {
  mode: ThemeMode;
}

/** Defaults for a fresh install: explicit dark (today's unchanged look). */
export const DEFAULT_THEME_PREFS: ThemePrefs = {
  mode: 'dark'
};

const VALID_MODES: readonly ThemeMode[] = ['dark', 'light', 'system'];

function isThemeMode(v: unknown): v is ThemeMode {
  return typeof v === 'string' && (VALID_MODES as readonly string[]).includes(v);
}

/** PURE: validate/normalize the persisted `theme` slice into a fully-defaulted
 *  `ThemePrefs`. Tolerates any shape — non-objects, missing fields, and
 *  wrong/unknown values fall back to `DEFAULT_THEME_PREFS` ('dark'). */
export function parseThemePrefs(raw: unknown): ThemePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_THEME_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    mode: isThemeMode(obj.mode) ? obj.mode : DEFAULT_THEME_PREFS.mode
  };
}

/** Reads the OS-level preference at call time. Defaults to `true` (dark) in a
 *  non-browser context (e.g. under SSR/build) so any accidental early read
 *  still lands on the app's default look rather than an arbitrary light flash. */
function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Reactive theme settings store. Singleton, imported by the settings modal
 * (read/write the mode), `+layout.svelte` (read `resolved` to stamp
 * `data-theme`), and any consumer that needs to react to theme changes
 * imperatively (e.g. `TerminalPane`'s xterm `$effect`).
 */
export class ThemeStore {
  /** The live preference (deep-reactive via the runes proxy). */
  prefs = $state<ThemePrefs>({ ...DEFAULT_THEME_PREFS });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** Live OS preference, tracked only while `mode === 'system'` is in play so a
   *  'system' selection follows the OS without a restart. */
  private systemDark = $state(systemPrefersDark());

  private mql: MediaQueryList | undefined;
  private readonly onSystemChange = (e: MediaQueryListEvent) => {
    this.systemDark = e.matches;
  };

  /** The theme actually applied: `mode` for 'dark'/'light', else the live OS
   *  preference for 'system'. */
  get resolved(): 'dark' | 'light' {
    if (this.prefs.mode === 'system') return this.systemDark ? 'dark' : 'light';
    return this.prefs.mode;
  }

  /** Load persisted prefs from the shared settings blob's `theme` slice. On a
   *  fresh install `DEFAULT_THEME_PREFS` applies (dark, unchanged look). Also
   *  arms the live `matchMedia` listener so a 'system' selection stays current.
   *  Never throws. Call once on mount. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    this.prefs = parseThemePrefs(settings.theme);
    this.loaded = true;
    this.watchSystem();
  }

  /** Select a mode and persist (best-effort). */
  setMode(mode: ThemeMode): void {
    this.prefs = { ...this.prefs, mode };
    void this.save();
  }

  /** Arm the `matchMedia` change listener exactly once (idempotent), so
   *  `resolved` stays live for a 'system' selection without a restart. A no-op
   *  outside a browser context. */
  private watchSystem(): void {
    if (this.mql || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    this.mql = window.matchMedia('(prefers-color-scheme: dark)');
    this.systemDark = this.mql.matches;
    this.mql.addEventListener('change', this.onSystemChange);
  }

  /** Persist the current prefs as the `theme` slice, merging into the shared
   *  settings blob so sibling slices are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('theme', this.prefs);
  }
}

/** The singleton theme store. */
export const theme = new ThemeStore();
