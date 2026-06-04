// Runes store for the TOP-LEVEL view mode (Stage 3 of agent-overview; spec:
// Overview As A Primary View). The app has two top-level surfaces:
//
//   - 'overview' — the inbox overview (Inbox.svelte). The DEFAULT: roster of
//                  every agent grouped by status; selecting one teleports the
//                  live surface into a focus pane without respawning the PTY.
//   - 'grid'     — the terminal grid (the tiling PaneNodes). Where you actually
//                  drive an agent's TUI; "dig in" / selecting an agent lands here,
//                  focused on that agent's pane.
//
// A thin latch (like `launcherStore`) kept in its own singleton so every entry
// point — the title-bar segmented control, the Cmd-O shortcut, and the per-agent
// "dig in" (which forces 'grid') — drives the same state without prop-drilling.
// `+page.svelte` reads `view.mode` to decide which surface to render.
//
// The pure transition logic (cycle toggles overview<->grid; show sets) is
// unit-tested against a fresh instance; the actual conditional render in the route
// is LIVE/MANUAL.

/** The two top-level views, in cycle order. */
export type ViewMode = 'overview' | 'grid';

const CYCLE: ViewMode[] = ['overview', 'grid'];

/** The reactive top-level view-mode store. A single instance is exported below. */
export class ViewStore {
  /** The current top-level view. Defaults to 'overview' (mission control). */
  mode = $state<ViewMode>('overview');

  /** Whether the card Overview (primary) surface is showing. */
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
   * Toggle to the next surface (the title-bar control / Cmd-O):
   * overview -> grid -> overview.
   */
  cycle(): void {
    const i = CYCLE.indexOf(this.mode);
    this.mode = CYCLE[(i + 1) % CYCLE.length];
  }
}

/** The singleton view store, imported by the route + overviews + the toggle UI. */
export const view = new ViewStore();
