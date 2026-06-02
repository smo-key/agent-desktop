// Reactive state for the single, app-wide pane context menu. PaneNode calls
// `contextMenu.show(...)` on right-click; PaneContextMenu renders it. Only one
// menu is open at a time, so a singleton store is the simplest model.

import type { PaneMenuSection } from './paneMenu';

class ContextMenuStore {
  /** Whether the menu is currently open. */
  open = $state(false);
  /** Anchor position (the cursor), in viewport pixels. */
  x = $state(0);
  y = $state(0);
  /** The sections to render. */
  sections = $state<PaneMenuSection[]>([]);

  /** Open the menu at (x, y) with the given sections. */
  show(x: number, y: number, sections: PaneMenuSection[]) {
    this.x = x;
    this.y = y;
    this.sections = sections;
    this.open = true;
  }

  /** Close the menu. */
  hide() {
    this.open = false;
  }
}

export const contextMenu = new ContextMenuStore();
