// PURE placement rules for plain terminals (tasks-panel: "Right-docked Terminals
// panel" / "Terminals can be combined into the sessions list"). Framework-free so
// the dock-visibility decision is unit-tested; +page.svelte applies it.

import type { TerminalsPlacement } from '../settings/uiPrefs.svelte';

/** Whether terminals are combined into the sessions list. */
export function terminalsCombined(placement: TerminalsPlacement): boolean {
  return placement === 'combined';
}

/**
 * Whether the right-docked Terminals dock is SHOWN: only in the separate-panel
 * placement, and only while toggled open. In the combined placement the dock is
 * never shown (it stays mounted, hidden, as every terminal's PTY home).
 */
export function showTerminalsDock(placement: TerminalsPlacement, open: boolean): boolean {
  return !terminalsCombined(placement) && open;
}
