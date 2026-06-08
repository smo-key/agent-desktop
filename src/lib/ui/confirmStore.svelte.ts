// Reactive runes store for a GENERIC confirmation MODAL — a reusable
// "are you sure?" dialog (mirrors helpStore/settingsStore as a singleton latch).
// A caller invokes `confirmModal.show({ title, message, confirmLabel?, onConfirm })`
// to open it; ConfirmModal.svelte renders from this state and calls `confirm()` on
// the danger button (which closes, then runs the stored callback) or `cancel()` on
// Cancel / Esc / backdrop / ×. The callback is held in a private field (not `$state`)
// so a function value never ends up in the reactive proxy.

/** Options for a single confirmation prompt. */
export interface ConfirmOptions {
  /** Dialog heading. */
  title: string;
  /** Body text explaining what will happen (and that it's irreversible). */
  message: string;
  /** Label for the confirm button. Defaults to "Delete". */
  confirmLabel?: string;
  /** Run when the user confirms. May be async; errors are the caller's concern. */
  onConfirm: () => void | Promise<void>;
}

/** The reactive confirmation-modal store. A single instance is exported. */
export class ConfirmModalStore {
  /** Whether the confirmation modal is currently shown. */
  open = $state(false);
  /** The current prompt's heading. */
  title = $state('');
  /** The current prompt's body text. */
  message = $state('');
  /** The current prompt's confirm-button label. */
  confirmLabel = $state('Delete');

  /** The confirm callback. Plain field (not reactive) so we never store a function
   *  in the runes proxy. Cleared on close so a stale callback can't fire later. */
  #onConfirm: (() => void | Promise<void>) | null = null;

  /** Open the modal with a prompt. Replaces any prompt already showing. */
  show(opts: ConfirmOptions): void {
    this.title = opts.title;
    this.message = opts.message;
    this.confirmLabel = opts.confirmLabel ?? 'Delete';
    this.#onConfirm = opts.onConfirm;
    this.open = true;
  }

  /** Confirm: close the modal FIRST (so the dialog dismisses immediately), then run
   *  the stored callback. Idempotent — a second call after close is a no-op. */
  confirm(): void | Promise<void> {
    const cb = this.#onConfirm;
    this.close();
    return cb?.();
  }

  /** Cancel/close without running the callback. Idempotent. Clears the callback so
   *  it can never fire after dismissal. */
  close(): void {
    this.open = false;
    this.#onConfirm = null;
  }
}

/** The singleton confirmation-modal store, imported by callers + ConfirmModal. */
export const confirmModal = new ConfirmModalStore();
