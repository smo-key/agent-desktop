// Reactive UI state for the Terminals panel's show/hide toggle. Kept separate from
// the terminal CONTENT store (projectTerminals) so toggling visibility never
// touches process state: the panel chrome stays mounted and is hidden via CSS, so
// running PTYs survive a hide (terminals-panel spec). Open state is in-memory
// (defaults off); the running processes — not the panel's visibility — are the
// durable thing worth persisting.
//
// The drag-resizable WIDTH, by contrast, is a remembered preference: it lives in
// the durable `ui` settings slice (`uiPrefs`), NOT localStorage (which WKWebView
// drops on an abrupt restart). This store is a thin façade over that value.

import { uiPrefs } from '../settings/uiPrefs.svelte';

export class TasksPanelUI {
  /** Whether the right-docked panel is currently shown. */
  open = $state(false);

  /** The docked panel width in px (drag-resizable, persisted across restarts). */
  get width(): number {
    return uiPrefs.data.terminalsWidth;
  }

  /** Toggle the panel on/off. */
  toggle(): void {
    this.open = !this.open;
  }

  /** Set the panel width (clamped) and persist the choice. */
  setWidth(px: number): void {
    uiPrefs.setTerminalsWidth(px);
  }
}

/** The singleton Terminals-panel UI store. */
export const tasksPanel = new TasksPanelUI();
