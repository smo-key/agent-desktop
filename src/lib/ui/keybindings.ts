// PURE keybinding vocabulary for the app's rebindable shortcuts (keyboard-shortcuts
// spec: "Keyboard shortcuts are user-customizable"). Framework-free — no Svelte,
// Tauri, or DOM imports beyond the `KeyboardEvent` shape — so every rule here is
// unit-tested headlessly (keybindings.test.ts):
//
//   - a `KeyChord` is one non-modifier key plus the four modifier flags; modifiers
//     are matched LITERALLY (⌘ is `metaKey` on every platform, as the handlers
//     always did);
//   - `SHORTCUT_DEFS` enumerates every rebindable action with its label, help
//     group, and default chord — the single source the handlers, the help modal,
//     the tooltips, and the Settings recorder all read;
//   - `resolveBindings` overlays validated user overrides on the defaults;
//   - `chordFromEvent` / `chordMatches` / `formatChord` / `parseChord` /
//     `findConflict` are the mechanics the store and the recorder compose.
//
// Fixed keys (Esc, bare `?`, the launcher's ⌘Enter, the voice tap, the in-terminal
// ⌘←/⌘→) are NOT chords here; they are documented as `FIXED_SHORTCUT_GROUPS`.

/** One key chord: a non-modifier key plus modifier flags. `key` is the
 *  `KeyboardEvent.key` value, normalized: single letters are stored UPPERCASE so
 *  ⇧ never changes the identity of a letter chord. */
export interface KeyChord {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/** The identities of every rebindable shortcut. */
export type ShortcutId =
  | 'newSession'
  | 'newWorktreeSession'
  | 'createTask'
  | 'toggleTerminals'
  | 'newTerminal'
  | 'cycleFocus'
  | 'showShortcuts'
  | 'insertFilePath'
  | 'nextAgent'
  | 'prevAgent'
  | 'nextProject'
  | 'prevProject'
  | 'archiveSession'
  | 'pauseSession';

/** The help-modal group a shortcut is listed under. */
export type ShortcutGroupTitle = 'Global' | 'Inbox' | 'Session' | 'Launcher' | 'Voice';

/** A rebindable shortcut: identity, human label, help group, default chord. */
export interface ShortcutDef {
  id: ShortcutId;
  label: string;
  group: ShortcutGroupTitle;
  default: KeyChord;
}

/** The minimal event shape the matcher reads (a `KeyboardEvent` satisfies it). */
export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** Physical key (`KeyA`, `Digit1`, …) — used for ⌥ chords, whose `key` is the
   *  layout-transformed character (`å`, `Dead`) on macOS. Optional. */
  code?: string;
}

function chord(key: string, mods: Partial<Omit<KeyChord, 'key'>> = {}): KeyChord {
  return {
    key: normalizeKey(key),
    meta: mods.meta ?? false,
    ctrl: mods.ctrl ?? false,
    alt: mods.alt ?? false,
    shift: mods.shift ?? false
  };
}

/** Every rebindable shortcut with its default binding, in help-modal order. */
export const SHORTCUT_DEFS: ReadonlyArray<ShortcutDef> = [
  { id: 'newSession', label: 'New session', group: 'Global', default: chord('n', { meta: true }) },
  {
    id: 'newWorktreeSession',
    label: 'New session in a git worktree',
    group: 'Global',
    default: chord('n', { meta: true, shift: true })
  },
  { id: 'createTask', label: 'Create task', group: 'Global', default: chord('t', { meta: true }) },
  {
    id: 'toggleTerminals',
    label: 'Toggle Terminals panel',
    group: 'Global',
    default: chord('j', { meta: true })
  },
  { id: 'newTerminal', label: 'New terminal', group: 'Global', default: chord('y', { meta: true }) },
  {
    id: 'cycleFocus',
    label: 'Cycle focus (agent / terminals)',
    group: 'Global',
    default: chord('Tab', { meta: true })
  },
  {
    id: 'showShortcuts',
    label: 'Show keyboard shortcuts',
    group: 'Global',
    default: chord('/', { meta: true })
  },
  { id: 'nextAgent', label: 'Next agent', group: 'Inbox', default: chord('ArrowDown', { meta: true }) },
  {
    id: 'prevAgent',
    label: 'Previous agent',
    group: 'Inbox',
    default: chord('ArrowUp', { meta: true })
  },
  {
    id: 'nextProject',
    label: 'Next project filter',
    group: 'Inbox',
    default: chord('ArrowDown', { meta: true, shift: true })
  },
  {
    id: 'prevProject',
    label: 'Previous project filter',
    group: 'Inbox',
    default: chord('ArrowUp', { meta: true, shift: true })
  },
  {
    id: 'archiveSession',
    label: 'Archive session',
    group: 'Session',
    default: chord('w', { meta: true })
  },
  {
    id: 'pauseSession',
    label: 'Pause / resume session',
    group: 'Session',
    default: chord('.', { meta: true })
  },
  {
    id: 'insertFilePath',
    label: 'Insert file path into terminal',
    group: 'Session',
    default: chord('o', { meta: true })
  }
];

/** Fixed (non-rebindable) keys, documented for the help modal in display tokens. */
export const FIXED_SHORTCUT_GROUPS: ReadonlyArray<{
  title: ShortcutGroupTitle;
  items: ReadonlyArray<{ keys: string[]; label: string }>;
}> = [
  {
    title: 'Global',
    items: [
      { keys: ['?'], label: 'Show shortcuts (when not typing)' },
      { keys: ['Esc'], label: 'Close dialog / menu' }
    ]
  },
  {
    title: 'Launcher',
    items: [
      { keys: ['⌘', 'Enter'], label: 'Confirm and launch' },
      { keys: ['Esc'], label: 'Cancel' }
    ]
  },
  { title: 'Voice', items: [{ keys: ['⌘'], label: 'Voice input (tap right Command)' }] }
];

/** The resolved chord for every shortcut. */
export type Bindings = Record<ShortcutId, KeyChord>;

/** Persisted overrides: only the shortcuts the user changed. */
export type BindingOverrides = Partial<Record<ShortcutId, KeyChord>>;

const DEF_BY_ID: ReadonlyMap<ShortcutId, ShortcutDef> = new Map(
  SHORTCUT_DEFS.map((d) => [d.id, d])
);

/** Whether `id` names a rebindable shortcut. */
export function isShortcutId(id: unknown): id is ShortcutId {
  return typeof id === 'string' && DEF_BY_ID.has(id as ShortcutId);
}

/** The default chord for `id`. */
export function defaultChord(id: ShortcutId): KeyChord {
  return { ...DEF_BY_ID.get(id)!.default };
}

/** The human label of `id`. */
export function shortcutLabel(id: ShortcutId): string {
  return DEF_BY_ID.get(id)!.label;
}

/** The default bindings (no overrides). */
export function defaultBindings(): Bindings {
  return resolveBindings({});
}

/**
 * Overlay overrides on the defaults. Unknown ids and invalid chords are dropped,
 * and so is any override that would leave two shortcuts on ONE chord (a
 * hand-edited slice, or a default that changed underneath an old override): the
 * colliding overrides are discarded and their defaults apply, so the resolved
 * bindings are always collision-free.
 */
export function resolveBindings(overrides: BindingOverrides | null | undefined): Bindings {
  const out = {} as Bindings;
  const overridden = new Set<ShortcutId>();
  for (const def of SHORTCUT_DEFS) {
    const raw = overrides ? overrides[def.id] : undefined;
    const parsed = raw === undefined ? null : parseChord(raw);
    if (parsed) overridden.add(def.id);
    out[def.id] = parsed ?? { ...def.default };
  }
  // Collision pass: drop every OVERRIDE that shares a chord with any other binding
  // (defaults are unique among themselves, so dropping overrides always converges).
  // Every colliding override in a pass is dropped TOGETHER (computed before any
  // mutation), so the outcome never depends on definition order; repeat until
  // stable (a restored default can itself collide with a remaining override).
  for (;;) {
    const clashing = [...overridden].filter((id) =>
      SHORTCUT_DEFS.some((d) => d.id !== id && sameChord(out[d.id], out[id]))
    );
    if (clashing.length === 0) return out;
    for (const id of clashing) {
      out[id] = defaultChord(id);
      overridden.delete(id);
    }
  }
}

/** Chords the webview / OS own app-wide (clipboard, select-all, undo, quit, hide):
 *  binding one would `preventDefault` it everywhere, including inside a terminal. */
const RESERVED_META_KEYS = new Set(['C', 'V', 'X', 'A', 'Z', 'Q', 'H']);

/** Whether a chord is reserved for the system and may not be recorded. */
export function isReservedChord(c: KeyChord): boolean {
  return c.meta && !c.ctrl && !c.alt && !c.shift && RESERVED_META_KEYS.has(normalizeKey(c.key));
}

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Fn', 'OS']);

/** Uppercase single letters so shift/case never change a letter chord's identity;
 *  everything else (`ArrowUp`, `Tab`, `/`, `.`) is kept verbatim. */
export function normalizeKey(key: string): string {
  return /^[a-z]$/i.test(key) ? key.toUpperCase() : key;
}

/** Whether a chord is RECORDABLE: a real (non-modifier) key, and either at least
 *  one of ⌘/⌃/⌥ or a function key — so plain typing (and bare ⇧+letter) can never
 *  be captured as a shortcut. */
export function isRecordableChord(c: KeyChord): boolean {
  if (!c.key || MODIFIER_KEYS.has(c.key)) return false;
  if (c.meta || c.ctrl || c.alt) return true;
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(c.key);
}

/**
 * The chord a keydown represents, or null when only modifiers are down (or the
 * key is a dead key with no physical fallback). With ⌥ held, macOS reports the
 * layout-transformed character in `key` (`å`, `Dead`, `∂`…), so the physical
 * `code` is used for letters and digits — `⌥N` is `{ key: 'N', alt }` whatever the
 * layout produced.
 */
export function chordFromEvent(e: KeyEventLike): KeyChord | null {
  if (!e.key || MODIFIER_KEYS.has(e.key)) return null;
  let key = e.key;
  if (e.altKey && typeof e.code === 'string') {
    const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code);
    if (m) key = m[1] ?? m[2];
  }
  if (key === 'Dead' || key === 'Unidentified') return null;
  return {
    key: normalizeKey(key),
    meta: !!e.metaKey,
    ctrl: !!e.ctrlKey,
    alt: !!e.altKey,
    shift: !!e.shiftKey
  };
}

/** Whether two chords are the same binding. */
export function sameChord(a: KeyChord, b: KeyChord): boolean {
  return (
    normalizeKey(a.key) === normalizeKey(b.key) &&
    a.meta === b.meta &&
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift
  );
}

/** Whether a keydown matches `c` EXACTLY (every modifier flag must agree). */
export function chordMatches(c: KeyChord, e: KeyEventLike): boolean {
  const ec = chordFromEvent(e);
  return ec !== null && sameChord(c, ec);
}

const KEY_TOKENS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  ' ': 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: '⌫',
  Delete: '⌦'
};

/** Display tokens for a chord, in the app's ⌃⌥⌘⇧ + key order (each a <kbd> chip;
 *  the registry has always written ⌘⇧↓, so ⌘ precedes ⇧). */
export function formatChord(c: KeyChord): string[] {
  const out: string[] = [];
  if (c.ctrl) out.push('⌃');
  if (c.alt) out.push('⌥');
  if (c.meta) out.push('⌘');
  if (c.shift) out.push('⇧');
  out.push(KEY_TOKENS[c.key] ?? normalizeKey(c.key));
  return out;
}

/** The chord as one inline string, e.g. `⌘⇧N` — for tooltips and menu hints. */
export function formatChordText(c: KeyChord): string {
  return formatChord(c).join('');
}

/** Validate an arbitrary persisted value into a chord (null when malformed or
 *  not recordable). */
export function parseChord(raw: unknown): KeyChord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.key !== 'string' || o.key === '') return null;
  const c: KeyChord = {
    key: normalizeKey(o.key),
    meta: o.meta === true,
    ctrl: o.ctrl === true,
    alt: o.alt === true,
    shift: o.shift === true
  };
  if (c.key === 'Dead' || c.key === 'Unidentified') return null;
  return isRecordableChord(c) && !isReservedChord(c) ? c : null;
}

/** Validate a persisted overrides object: keeps only known ids with valid chords. */
export function parseOverrides(raw: unknown): BindingOverrides {
  const out: BindingOverrides = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isShortcutId(id)) continue;
    const c = parseChord(value);
    if (c) out[id] = c;
  }
  return out;
}

/** The OTHER shortcut currently bound to `c`, or null when `c` is free. */
export function findConflict(
  bindings: Bindings,
  id: ShortcutId,
  c: KeyChord
): ShortcutId | null {
  for (const def of SHORTCUT_DEFS) {
    if (def.id === id) continue;
    if (sameChord(bindings[def.id], c)) return def.id;
  }
  return null;
}
