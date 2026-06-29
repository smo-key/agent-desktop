// The session pane currently under a file drag (terminal-file-drop). The native
// drag-drop listener in `fileDrop.ts` sets `paneId` to the pane under the cursor
// on enter/over and clears it on leave/drop; `TerminalPane` reads it to render a
// drop-target affordance on the matching pane. A tiny reactive singleton — view
// state, not topology — so it never touches the workspace store.

class DropTarget {
  /** Pane id under the dragged file, or `null` when no session is targeted. */
  paneId = $state<string | null>(null);
}

export const dropTarget = new DropTarget();
