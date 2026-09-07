// Custom keyboard-shortcut bindings — the `shortcuts` slice of the shared
// `settings.json` blob (keyboard-shortcuts spec: "Keyboard shortcuts are
// user-customizable"). Like the sibling pref stores it loads once on startup and
// saves (best-effort, merge-aware) on every change so it never clobbers other
// slices; this store is the slice's sole writer. Only OVERRIDES are stored — a
// shortcut the user never touched is absent and resolves to its default — so a
// later change to a default reaches every user who didn't customize it.
//
// The pure mechanics (chord matching, formatting, validation, conflict detection)
// live in `$lib/ui/keybindings`; this store is the reactive overlay the key
// handlers (`matches`), the tooltips/help modal (`text`/`bindings`), and the
// Settings recorder (`setBinding`/`resetBinding`/`resetAll`) read.

import { loadSettings, saveSettingsSlice } from './persist';
import {
  chordMatches,
  defaultChord,
  findConflict,
  formatChordText,
  parseOverrides,
  resolveBindings,
  sameChord,
  type BindingOverrides,
  type Bindings,
  type KeyChord,
  type KeyEventLike,
  type ShortcutId
} from '$lib/ui/keybindings';

/** The settings.json top-level key this store owns. */
const SLICE_KEY = 'shortcuts';

/** The persisted shape: only the user's overrides. */
export interface ShortcutPrefs {
  overrides: BindingOverrides;
}

/** Defaults for a fresh install: no overrides. */
export const DEFAULT_SHORTCUT_PREFS: ShortcutPrefs = { overrides: {} };

/** PURE: validate/normalize the persisted `shortcuts` slice. Tolerates any shape;
 *  unknown ids and malformed / non-recordable chords are dropped. */
export function parseShortcutPrefs(raw: unknown): ShortcutPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { overrides: {} };
  }
  const o = raw as Record<string, unknown>;
  return { overrides: parseOverrides(o.overrides) };
}

/** The result of trying to record a chord for a shortcut. */
export type SetBindingResult = { ok: true } | { ok: false; conflict: ShortcutId };

/** Reactive shortcuts store. Singleton, read by the key handlers + hints and
 *  written by the Settings recorder. */
export class ShortcutsStore {
  /** The live prefs (overrides only). */
  prefs = $state<ShortcutPrefs>({ overrides: {} });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** The resolved chord for every shortcut (defaults overlaid with overrides). */
  get bindings(): Bindings {
    return resolveBindings(this.prefs.overrides);
  }

  /** The current chord for `id`. */
  chord(id: ShortcutId): KeyChord {
    return this.bindings[id];
  }

  /** The current chord for `id` as an inline hint, e.g. `⌘N`. */
  text(id: ShortcutId): string {
    return formatChordText(this.chord(id));
  }

  /** Whether a keydown is the shortcut `id` (exact modifier match). */
  matches(e: KeyEventLike, id: ShortcutId): boolean {
    return chordMatches(this.chord(id), e);
  }

  /** Whether `id` is customized (differs from its default). */
  isCustomized(id: ShortcutId): boolean {
    const o = this.prefs.overrides[id];
    return o !== undefined && !sameChord(o, defaultChord(id));
  }

  /** Load the persisted slice. Never throws. Call once on mount. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    this.prefs = parseShortcutPrefs(settings[SLICE_KEY]);
    this.loaded = true;
  }

  /** Record `chord` for `id`. Refused (no change) when another shortcut already
   *  uses it — the conflict is returned so the recorder can name it. Recording a
   *  shortcut's own default drops its override instead of storing a no-op one. */
  setBinding(id: ShortcutId, chord: KeyChord): SetBindingResult {
    const conflict = findConflict(this.bindings, id, chord);
    if (conflict) return { ok: false, conflict };
    const overrides: BindingOverrides = { ...this.prefs.overrides };
    if (sameChord(chord, defaultChord(id))) delete overrides[id];
    else overrides[id] = { ...chord };
    this.prefs = { overrides };
    void this.save();
    return { ok: true };
  }

  /** Restore `id` to its default (drop its override). No write when not overridden. */
  resetBinding(id: ShortcutId): void {
    if (this.prefs.overrides[id] === undefined) return;
    const overrides: BindingOverrides = { ...this.prefs.overrides };
    delete overrides[id];
    this.prefs = { overrides };
    void this.save();
  }

  /** Restore every shortcut to its default. */
  resetAll(): void {
    if (Object.keys(this.prefs.overrides).length === 0) return;
    this.prefs = { overrides: {} };
    void this.save();
  }

  private async save(): Promise<void> {
    await saveSettingsSlice(SLICE_KEY, this.prefs);
  }
}

/** The singleton shortcuts store. */
export const shortcuts = new ShortcutsStore();
