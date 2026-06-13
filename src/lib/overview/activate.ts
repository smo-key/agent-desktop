// PURE activation-intent resolution for a clicked needs-input notification
// (capability `alert-click-focus`). The Rust side emits an
// `agent-notification-activated` event carrying the alerting agent's `paneId`;
// the always-mounted route turns that into two effects: ALWAYS focus the window,
// and select the agent ONLY when a live leaf still carries its pane. This module
// is the framework-free core of that decision, so the "select live agent" vs
// "dead-pane focus-only" branch is unit-tested without a window.
//
// The window focus + the Tauri `listen`/`getCurrentWindow` calls stay in the
// route (LIVE/MANUAL); here we only decide WHAT should happen.

import { navigateTarget, type NavWorkspace } from './navigate';

/** What a notification activation should do. `focusWindow` is always true; the
 *  window comes forward regardless. `selectPaneId` is the agent to select, or
 *  null when its session has ended (no live leaf carries it) — then we focus the
 *  window only. */
export interface ActivationIntent {
  /** Always true: a click always raises/focuses the window. */
  focusWindow: true;
  /** The agent to select in the overview, or null to focus the window only. */
  selectPaneId: string | null;
}

/**
 * PURE: resolve what clicking the notification for `paneId` should do, given the
 * live workspaces. Selects the agent when a live leaf carries its pane; otherwise
 * (a stale/ended session) returns a focus-window-only intent.
 */
export function activationIntent(
  paneId: string,
  workspaces: readonly NavWorkspace[]
): ActivationIntent {
  const target = navigateTarget(workspaces, paneId);
  return { focusWindow: true, selectPaneId: target ? paneId : null };
}
