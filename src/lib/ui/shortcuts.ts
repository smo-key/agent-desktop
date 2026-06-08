// The keyboard-shortcut REGISTRY — the single source of truth the help modal
// (HelpModal.svelte) renders. The actual key HANDLERS still live where they apply
// (the global `onKeydown` in +page.svelte, the inbox nav in Inbox.svelte, the
// launcher's own keys), so this list DOCUMENTS them rather than wiring them; keep
// the two in sync when you add or change a binding. `keys` are display tokens
// (⌘, ⇧, ⌥, ↑/↓/←/→) — each renders as a <kbd> chip.

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

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Global',
    items: [
      { keys: ['⌘', 'N'], label: 'New session (launcher)' },
      { keys: ['⌘', 'T'], label: 'Create task' },
      { keys: ['⌘', 'J'], label: 'Toggle Terminals panel' },
      { keys: ['⌘', 'Y'], label: 'New terminal' },
      { keys: ['⌘', 'Tab'], label: 'Cycle focus (agent / terminals)' },
      { keys: ['⌘', '/'], label: 'Show keyboard shortcuts' },
      { keys: ['?'], label: 'Show shortcuts (when not typing)' },
      { keys: ['Esc'], label: 'Close dialog / menu' }
    ]
  },
  {
    title: 'Inbox',
    items: [
      { keys: ['⌘', '↓'], label: 'Next agent' },
      { keys: ['⌘', '↑'], label: 'Previous agent' },
      { keys: ['⌘', '⇧', '↓'], label: 'Next project filter' },
      { keys: ['⌘', '⇧', '↑'], label: 'Previous project filter' }
    ]
  },
  {
    title: 'Session',
    items: [
      { keys: ['⌘', 'W'], label: 'Archive session' },
      { keys: ['⌘', '.'], label: 'Pause / resume session' }
    ]
  },
  {
    title: 'Launcher',
    items: [
      { keys: ['⌘', 'Enter'], label: 'Confirm and launch' },
      { keys: ['Esc'], label: 'Cancel' }
    ]
  },
  {
    title: 'Voice',
    items: [
      { keys: ['⌘'], label: 'Voice input (tap right Command)' },
      { keys: ['Mic'], label: 'Voice input (click the footer mic button)' }
    ]
  }
];
