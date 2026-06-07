// Reactive store for transient TOAST notifications — small, self-dismissing
// messages shown at a corner of the app (e.g. "Build completed" when a task
// succeeds). A thin singleton (like the launcher / help / settings stores) so any
// caller can `toast.show(...)` without prop-drilling; the root-mounted
// `Toast.svelte` renders `toast.items`.

/** One live toast. `id` is a monotonic key for the keyed list + dismissal. */
export interface ToastItem {
  id: number;
  message: string;
}

/** Default time a toast stays up before auto-dismissing (ms). */
const DEFAULT_DURATION = 3200;

export class ToastStore {
  /** The currently-visible toasts, oldest first. Deep-reactive via the runes proxy. */
  items = $state<ToastItem[]>([]);

  /** Monotonic id factory (process-local). */
  private seq = 0;

  /**
   * Show a toast `message`. Returns its id. It auto-dismisses after `durationMs`
   * (pass `0` to keep it until dismissed explicitly). Multiple toasts stack.
   */
  show(message: string, durationMs: number = DEFAULT_DURATION): number {
    const id = ++this.seq;
    this.items = [...this.items, { id, message }];
    if (durationMs > 0 && typeof setTimeout === 'function') {
      setTimeout(() => this.dismiss(id), durationMs);
    }
    return id;
  }

  /** Remove the toast with `id` (no-op if already gone). */
  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

/** The singleton toast store, imported by the trigger sites + `Toast.svelte`. */
export const toast = new ToastStore();
