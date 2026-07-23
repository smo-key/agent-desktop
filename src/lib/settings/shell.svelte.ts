// Shell preference: the program a new terminal/shell pane launches
// (`shell-selection` capability). Stored as the `shell` slice of the shared
// `settings.json` blob, like the other settings stores — loaded once on startup,
// saved (best-effort, merge-aware) on change so sibling slices survive.
//
// An EMPTY preference means "use the platform default", which the backend
// resolves via the `default_shell` command (`pwsh` → `powershell.exe` on Windows,
// `$SHELL` → `/bin/zsh` on Unix). Both values are pushed into the pure
// `$lib/shell/defaultShell` module, which is what the layout code actually reads
// — so the resolution logic stays framework-free and unit-tested.

import { invoke } from '@tauri-apps/api/core';
import {
  platformDefaultShell,
  setPlatformDefaultShell,
  setShellPreference
} from '$lib/shell/defaultShell';
import { loadSettings, saveSettingsSlice } from './persist';

/** Shell preference. `program` empty means "use the platform default". */
export interface ShellPrefs {
  program: string;
}

/** Defaults for a fresh install: no explicit choice, so the platform default applies. */
export const DEFAULT_SHELL_PREFS: ShellPrefs = { program: '' };

/** PURE: validate/normalize the persisted `shell` slice. Tolerates any shape —
 *  non-objects, missing fields, and wrong types fall back to "unset". */
export function parseShellPrefs(raw: unknown): ShellPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_SHELL_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  const program = typeof obj.program === 'string' ? obj.program.trim() : '';
  return { program };
}

/**
 * Reactive shell settings store. Singleton, imported by the settings modal
 * (read/write). The layout code reads the resolved value from
 * `$lib/shell/defaultShell` instead, which this store keeps in sync.
 */
export class ShellStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<ShellPrefs>({ ...DEFAULT_SHELL_PREFS });

  /** The backend-resolved platform default, shown when no preference is set. */
  platformDefault = $state<string>(platformDefaultShell());

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /**
   * Resolve the platform default from the backend, then load the persisted
   * preference. Both are pushed into the pure resolver module. Never throws —
   * a failed `default_shell` invoke leaves the Unix default in place, which is
   * exactly the pre-existing behavior. Call once on mount.
   */
  async load(): Promise<void> {
    try {
      const resolved = await invoke<string>('default_shell');
      setPlatformDefaultShell(resolved);
      this.platformDefault = platformDefaultShell();
    } catch {
      // Non-Tauri/dev context or command failure: keep the existing default.
    }
    try {
      const settings = await loadSettings();
      this.prefs = parseShellPrefs(settings.shell);
      setShellPreference(this.prefs.program || null);
    } catch {
      // Keep the defaults. This MUST NOT reject: the layout restore in
      // +page.svelte is chained onto this promise, so a rejection here would
      // leave the user with no restored panes at all.
    }
    this.loaded = true;
  }

  /** Set the shell program (empty string clears back to the platform default). */
  setProgram(program: string): void {
    const trimmed = typeof program === 'string' ? program.trim() : '';
    this.prefs = { ...this.prefs, program: trimmed };
    setShellPreference(trimmed || null);
    void this.save();
  }

  /** Persist the current prefs as the `shell` slice, merging into the shared
   *  settings blob so sibling slices are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('shell', this.prefs);
  }
}

/** The singleton shell store. */
export const shellSettings = new ShellStore();
