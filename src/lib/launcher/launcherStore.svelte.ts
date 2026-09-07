// Reactive runes store for the session-launcher MODAL's open/close state, plus
// the one-shot PRESET an entry point may hand it. A thin piece of UI state kept
// in its own singleton so the entry points — the SessionRail "+ new session"
// row, the pane context menu "New Session" item, the Cmd-N shortcut, and the
// new-worktree-session shortcut in +page.svelte — can all open the same modal
// without prop-drilling. The modal component (Launcher.svelte) reads
// `launcher.open` to render, seeds its form from the preset on the open
// transition, and calls `launcher.close()` on confirm/cancel.
//
// The launcher carries no folder/prompt/placement state itself — that lives in
// the modal's local component state and is handed to `workspace.launch(plan)` on
// confirm. The preset is consumed on open: it only SEEDS the form.
//
// NOTE: named `launcherStore.svelte.ts` (not `launcher.svelte.ts`) to avoid a
// case-insensitive-filesystem collision with the `Launcher.svelte` component.

/** What an entry point can preset when it opens the launcher. */
export interface LauncherPreset {
  /** Pre-check "Start in a new git worktree" (session-launcher). */
  worktree?: boolean;
  /** Preselect this project (e.g. the roster's current project filter). */
  projectId?: string | null;
}

/** The reactive launcher (open/close + preset) store. A single instance is exported below. */
export class LauncherStore {
  /** Whether the launcher modal is currently shown. */
  open = $state(false);

  /** Whether the worktree option should start CHECKED for this open. */
  presetWorktree = $state(false);

  /** The project to preselect for this open, or null for none. */
  presetProjectId = $state<string | null>(null);

  /** Show the launcher modal, optionally with a form preset. Idempotent. */
  show(preset: LauncherPreset = {}): void {
    this.presetWorktree = preset.worktree === true;
    this.presetProjectId = preset.projectId ?? null;
    this.open = true;
  }

  /** Hide the launcher modal (confirm or cancel). Clears the preset. Idempotent. */
  close(): void {
    this.open = false;
    this.presetWorktree = false;
    this.presetProjectId = null;
  }

  /** Toggle the launcher (handy for a single keyboard shortcut). */
  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }
}

/** The singleton launcher store, imported by the entry points + Launcher.svelte. */
export const launcher = new LauncherStore();
