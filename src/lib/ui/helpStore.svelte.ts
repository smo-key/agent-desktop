// Reactive runes store for the keyboard-shortcuts help MODAL's open/close state.
// A thin open/close latch (mirrors launcherStore) kept in its own singleton so the
// entry points — the ⌘/ and ? shortcuts plus the title-bar "?" button in
// +page.svelte — can all open the same modal without prop-drilling. HelpModal.svelte
// reads `help.open` to render and calls `help.close()` on Esc / backdrop / button.

/** The reactive help-modal (open/close) store. A single instance is exported below. */
export class HelpStore {
  /** Whether the help modal is currently shown. */
  open = $state(false);

  /** Show the help modal. Idempotent. */
  show(): void {
    this.open = true;
  }

  /** Hide the help modal. Idempotent. */
  close(): void {
    this.open = false;
  }

  /** Toggle the help modal (for a single keyboard shortcut). */
  toggle(): void {
    this.open = !this.open;
  }
}

/** The singleton help store, imported by the entry points + HelpModal.svelte. */
export const help = new HelpStore();
