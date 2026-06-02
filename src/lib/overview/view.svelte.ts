// Runes store for the TOP-LEVEL view mode (Stage 3 of agent-overview; spec:
// Overview As A Primary View). The app has two top-level surfaces:
//
//   - 'overview' — the mission-control roster (Overview.svelte). The DEFAULT: the
//                  user expects to spend most of their time here, scanning every
//                  agent + its subagents and messaging/launching from one place.
//   - 'grid'     — the terminal grid (the tiling PaneNodes). Where you actually
//                  drive an agent's TUI; selecting an agent in the overview lands
//                  here, focused on that agent's pane.
//
// A thin open/close-style latch (like `launcherStore`), kept in its own singleton
// so every entry point — the title-bar toggle button, the Cmd-O shortcut, and the
// per-agent card click (which forces 'grid') — drives the same state without
// prop-drilling. `+page.svelte` reads `view.mode` to decide which surface to render.
//
// The pure transition logic (toggle alternates overview<->grid; show sets) is
// unit-tested against a fresh instance; the actual conditional render in the route
// is LIVE/MANUAL.

/** The two top-level views. */
export type ViewMode = 'overview' | 'grid';

/** The reactive top-level view-mode store. A single instance is exported below. */
export class ViewStore {
  /** The current top-level view. Defaults to 'overview' (mission control). */
  mode = $state<ViewMode>('overview');

  /** Whether the Overview (primary) surface is showing. */
  get isOverview(): boolean {
    return this.mode === 'overview';
  }

  /** Whether the terminal grid is showing. */
  get isGrid(): boolean {
    return this.mode === 'grid';
  }

  /** Switch to an explicit view. Idempotent. */
  show(mode: ViewMode): void {
    this.mode = mode;
  }

  /**
   * Alternate between overview and grid (the title-bar toggle / Cmd-O). From
   * 'overview' this lands on 'grid'; from 'grid' it lands on 'overview'.
   */
  toggle(): void {
    this.mode = this.mode === 'grid' ? 'overview' : 'grid';
  }
}

/** The singleton view store, imported by the route + Overview + the toggle UI. */
export const view = new ViewStore();
