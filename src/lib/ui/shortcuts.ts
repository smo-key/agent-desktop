// The keyboard-shortcut REGISTRY the help modal (HelpModal.svelte) renders. It is
// DERIVED from the rebindable definitions + current bindings in `keybindings.ts`
// (the same source the key handlers match against, so the modal can never drift
// from the handlers) plus the fixed, non-rebindable keys. `keys` are display
// tokens (⌘, ⇧, ⌥, ↑/↓/←/→) — each renders as a <kbd> chip.
//
// `SHORTCUTS` is the registry at the DEFAULT bindings (a stable constant for
// tests and docs); `shortcutGroups(bindings)` builds it for the user's CURRENT
// bindings, which is what the modal shows.

import {
  FIXED_SHORTCUT_GROUPS,
  SHORTCUT_DEFS,
  defaultBindings,
  formatChord,
  type Bindings,
  type ShortcutGroupTitle
} from './keybindings';

/** One shortcut: a key combo (display tokens) and what it does. */
export interface Shortcut {
  keys: string[];
  label: string;
}

/** A titled group of shortcuts (a section in the help modal). */
export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

/** Section order in the modal. */
const GROUP_ORDER: ShortcutGroupTitle[] = ['Global', 'Inbox', 'Session', 'Launcher', 'Voice'];

/**
 * Build the help-modal registry for `bindings`: every rebindable shortcut under
 * its group, in definition order, followed by the group's fixed keys. Groups
 * with nothing to show are omitted. Pure.
 */
export function shortcutGroups(bindings: Bindings): ShortcutGroup[] {
  const out: ShortcutGroup[] = [];
  for (const title of GROUP_ORDER) {
    const items: Shortcut[] = [];
    for (const def of SHORTCUT_DEFS) {
      if (def.group !== title) continue;
      items.push({ keys: formatChord(bindings[def.id]), label: def.label });
    }
    const fixed = FIXED_SHORTCUT_GROUPS.find((g) => g.title === title);
    if (fixed) for (const f of fixed.items) items.push({ keys: [...f.keys], label: f.label });
    if (items.length > 0) out.push({ title, items });
  }
  return out;
}

/** The registry at the default bindings. */
export const SHORTCUTS: ShortcutGroup[] = shortcutGroups(defaultBindings());
