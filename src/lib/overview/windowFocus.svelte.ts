// Reactive OS-window focus state for the needs-input alerts. `appFocused` is true
// when the Agent Desktop window has focus AND its document is visible — the signal
// the `app-unfocused` / `agent-unfocused` alert modes gate on. Kept in its own tiny
// store so the pure alert core (`notify.ts`) stays free of browser globals and the
// value is easy to reason about. The Inbox calls `start()` from an `$effect` and
// runs the returned cleanup on teardown.

/** Whether the window is focused-and-visible right now (true outside the browser). */
function computeFocused(): boolean {
  if (typeof document === 'undefined') return true;
  return document.hasFocus() && document.visibilityState !== 'hidden';
}

/** Reactive window-focus store. Singleton, read by the inbox alert shell. */
export class WindowFocusStore {
  /** True while the app window is focused and visible. Defaults to true so a
   *  non-browser / SSR context never spuriously reports "unfocused". */
  focused = $state(true);

  /** Begin tracking window focus/blur + document visibility. Returns a cleanup
   *  that removes the listeners. A no-op (and no-op cleanup) outside the browser. */
  start(): () => void {
    if (typeof window === 'undefined') return () => {};
    const update = () => {
      this.focused = computeFocused();
    };
    update();
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }
}

/** The singleton window-focus store. */
export const windowFocus = new WindowFocusStore();
