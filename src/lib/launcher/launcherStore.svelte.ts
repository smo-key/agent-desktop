// Reactive runes store for the session-launcher MODAL's open/close state. A thin
// piece of UI state (is the launcher showing?), kept in its own singleton so the
// three entry points — the SessionRail "+ new session" row, the pane context
// menu "New Session" item, and the Cmd-N shortcut in +page.svelte — can all open
// the same modal without prop-drilling. The modal component (Launcher.svelte)
// reads `launcher.open` to render, and calls `launcher.close()` on confirm/cancel.
//
// The launcher carries no folder/prompt/placement state itself — that lives in
// the modal's local component state and is handed to `workspace.launch(plan)` on
// confirm. This store is ONLY the open/close latch.
//
// NOTE: named `launcherStore.svelte.ts` (not `launcher.svelte.ts`) to avoid a
// case-insensitive-filesystem collision with the `Launcher.svelte` component.

/** The reactive launcher (open/close) store. A single instance is exported below. */
export class LauncherStore {
  /** Whether the launcher modal is currently shown. */
  open = $state(false);

  /** Show the launcher modal. Idempotent. */
  show(): void {
    this.open = true;
  }

  /** Hide the launcher modal (confirm or cancel). Idempotent. */
  close(): void {
    this.open = false;
  }

  /** Toggle the launcher (handy for a single keyboard shortcut). */
  toggle(): void {
    this.open = !this.open;
  }
}

/** The singleton launcher store, imported by the entry points + Launcher.svelte. */
export const launcher = new LauncherStore();
