// Pure, framework-free model for the pane right-click menu. The .svelte renderer
// just paints whatever `buildPaneMenu` returns and calls each item's `run`. Kept
// pure so the action wiring (which op each item triggers) is unit-testable
// without a DOM, a real terminal, or the Tauri bridge.

import type { Direction, SplitWhere } from './tree';

/** Side-effecting operations a menu item can trigger. Injected by the caller. */
export interface PaneMenuDeps {
  /** Split the (already-focused) pane in `direction`, new pane placed `where`. */
  split(direction: Direction, where: SplitWhere): void;
  /** Close the focused pane. */
  close(): void;
  /** Open a brand-new workspace ("session") in the rail. */
  newSession(): void;
  /** Copy the pane's current selection to the system clipboard. */
  copy(): void;
  /** Paste the clipboard into the pane's PTY. */
  paste(): void;
  /** Whether closing is allowed (false when this is the workspace's only pane). */
  canClose: boolean;
  /** Whether there is a selection to copy. */
  hasSelection: boolean;
}

export interface PaneMenuItem {
  /** Stable id (used as the test/lookup key, never shown). */
  id: string;
  /** Visible label. */
  label: string;
  /** Right-aligned shortcut hint (display only). */
  shortcut?: string;
  /** Greyed-out + non-invokable when true. */
  disabled?: boolean;
  /** The action; the renderer calls this then closes the menu. */
  run(): void;
}

/** Menu items grouped into divider-separated sections. */
export type PaneMenuSection = PaneMenuItem[];

/**
 * Build the pane context menu: Copy/Paste, the four split directions, then
 * Close / New Session. Disabled state for Copy (no selection) and Close (only
 * pane) comes from `deps`.
 */
export function buildPaneMenu(deps: PaneMenuDeps): PaneMenuSection[] {
  return [
    [
      {
        id: 'copy',
        label: 'Copy',
        shortcut: '⌘C',
        disabled: !deps.hasSelection,
        run: () => deps.copy()
      },
      { id: 'paste', label: 'Paste', shortcut: '⌘V', run: () => deps.paste() }
    ],
    [
      {
        id: 'split-right',
        label: 'Split Right',
        shortcut: '⌘D',
        run: () => deps.split('row', 'after')
      },
      {
        id: 'split-down',
        label: 'Split Down',
        shortcut: '⌘⇧D',
        run: () => deps.split('col', 'after')
      },
      {
        id: 'split-left',
        label: 'Split Left',
        run: () => deps.split('row', 'before')
      },
      {
        id: 'split-up',
        label: 'Split Up',
        run: () => deps.split('col', 'before')
      }
    ],
    [
      {
        id: 'close',
        label: 'Close Pane',
        shortcut: '⌘W',
        disabled: !deps.canClose,
        run: () => deps.close()
      },
      {
        id: 'new-session',
        label: 'New Session',
        shortcut: '⌘T',
        run: () => deps.newSession()
      }
    ]
  ];
}
