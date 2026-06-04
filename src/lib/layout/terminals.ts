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
  /**
   * Send `text` to the pane's PTY as a message: the EXACT text followed by a
   * SINGLE carriage return (`\r`), via the same `pty_write` path. Used by the
   * agent-overview "message an agent" action to deliver the user's text to a pane
   * without navigating to it. Sends ONLY the given text — it never synthesizes a
   * slash command or any other input on the user's behalf.
   *
   * Returns `true` when the text was written to a live PTY, `false` when there is
   * nothing to write to (the pane's process has exited / no PTY is wired) so the
   * caller never reports a false success against a dead agent.
   */
  send(text: string): boolean;
  /**
   * Write RAW bytes to the pane's PTY VERBATIM — no trailing carriage return, no
   * transformation. Used to answer an interactive menu (e.g. a pending
   * `AskUserQuestion`) by sending navigation/control sequences (arrow keys, Enter)
   * straight to the live TUI. Returns `true` when written to a live PTY, `false`
   * when the pane's process has exited / no PTY is wired.
   */
  sendKeys(data: string): boolean;
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
