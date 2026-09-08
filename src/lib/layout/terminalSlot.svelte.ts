// Where the SELECTED plain terminal's live surface should currently live (tasks-
// panel: "Terminals can be combined into the sessions list"). The mirror of
// `surfaceSlot` for the right-dock terminals: every terminal stays MOUNTED in the
// (hidden) dock as its PTY home, and when the inbox focuses a terminal row it
// names that pane here together with a target element; the dock relocates that
// entry's body into the target with the `portal` action — never remounting it —
// and restores it home when the selection moves on or the slot clears.

export class TerminalSlot {
  /** The pane id of the terminal to teleport, or null for none. */
  paneId = $state<string | null>(null);
  /** The element to teleport it into, or null for home. */
  target = $state<HTMLElement | null>(null);

  /** Teleport `paneId`'s surface into `el`. */
  set(paneId: string, el: HTMLElement): void {
    this.paneId = paneId;
    this.target = el;
  }

  /** Send the selected terminal home (no terminal is focused). */
  clear(): void {
    this.paneId = null;
    this.target = null;
  }

  /** The teleport target for `paneId`: the slot element when it is the selected
   *  terminal, else null (home). */
  targetFor(paneId: string): HTMLElement | null {
    return this.paneId === paneId ? this.target : null;
  }
}

/** The singleton terminal-slot store. */
export const terminalSlot = new TerminalSlot();
