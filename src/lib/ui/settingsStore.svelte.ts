// Reactive runes store for the Settings MODAL's open/close state. A thin open/close
// latch (mirrors helpStore) kept in its own singleton so the entry points — the
// title-bar gear button — can open the same modal. SettingsModal.svelte reads
// `settingsModal.open` to render and calls `settingsModal.close()` on Esc /
// backdrop / button.

/** The reactive settings-modal (open/close) store. A single instance is exported. */
export class SettingsModalStore {
  /** Whether the settings modal is currently shown. */
  open = $state(false);

  /** Show the settings modal. Idempotent. */
  show(): void {
    this.open = true;
  }

  /** Hide the settings modal. Idempotent. */
  close(): void {
    this.open = false;
  }

  /** Toggle the settings modal. */
  toggle(): void {
    this.open = !this.open;
  }
}

/** The singleton settings-modal store, imported by the entry points + SettingsModal. */
export const settingsModal = new SettingsModalStore();
