// A tiny imperative registry mapping a frontend `paneId` to a handle on that
// pane's live xterm terminal. TerminalPane registers itself on mount and
// unregisters on destroy; the pane context menu reads it for Copy/Paste without
// the menu needing a reference to the xterm instance (keeps the menu decoupled
// from the terminal component). Deliberately NOT reactive — it is a side-channel
// of imperative handles, not UI state.

export interface TerminalHandle {
  /** The current selection text (empty string if nothing is selected). */
  getSelection(): string;
  /** Whether there is a non-empty selection right now. */
  hasSelection(): boolean;
  /** Write text into the pane's PTY (used for paste). */
  paste(text: string): void;
}

const handles = new Map<string, TerminalHandle>();

export function registerTerminal(paneId: string, handle: TerminalHandle): void {
  handles.set(paneId, handle);
}

export function unregisterTerminal(paneId: string): void {
  handles.delete(paneId);
}

export function getTerminal(paneId: string): TerminalHandle | undefined {
  return handles.get(paneId);
}
