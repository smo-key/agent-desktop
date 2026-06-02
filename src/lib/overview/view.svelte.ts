// Runes store for the TOP-LEVEL view mode (Stage 3 of agent-overview; spec:
// Overview As A Primary View — extended by workflow-board STAGE 2). The app has
// three top-level surfaces:
//
//   - 'overview' — the mission-control roster (Overview.svelte). The DEFAULT: the
//                  user expects to spend most of their time here, scanning every
//                  agent + its subagents and messaging/launching from one place.
//   - 'grid'     — the terminal grid (the tiling PaneNodes). Where you actually
//                  drive an agent's TUI; selecting an agent in the overview lands
//                  here, focused on that agent's pane.
//   - 'workflow' — the read-only Workflow board (WorkflowBoard.svelte) for the
//                  focused pane's repo. Opened by its own title-bar toggle +
//                  Cmd-Shift-K; it does NOT participate in the overview<->grid
//                  `toggle()` so that alternation stays exactly two-way.
//
// A thin open/close-style latch (like `launcherStore`), kept in its own singleton
// so every entry point — the title-bar toggle buttons, the Cmd-O / Cmd-Shift-K
// shortcuts, the per-agent card click (which forces 'grid'), and the "back" controls
// — drives the same state without prop-drilling. `+page.svelte` reads `view.mode`
// to decide which surface to render.
//
// The pure transition logic (toggle alternates overview<->grid; show/showWorkflow
// set) is unit-tested against a fresh instance; the actual conditional render in the
// route is LIVE/MANUAL.

/** The three top-level views. */
export type ViewMode = 'overview' | 'grid' | 'workflow';

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

  /** Whether the read-only Workflow board is showing. */
  get isWorkflow(): boolean {
    return this.mode === 'workflow';
  }

  /** Switch to an explicit view. Idempotent. */
  show(mode: ViewMode): void {
    this.mode = mode;
  }

  /**
   * Alternate between overview and grid (the title-bar toggle / Cmd-O). Two-way by
   * design: the workflow board is reached via its own entry points, not this
   * toggle. From 'overview' (or 'workflow') this lands on 'grid'; from 'grid' it
   * lands on 'overview' — so a user on the workflow board pressing Cmd-O drops back
   * into the grid where the focused pane lives.
   */
  toggle(): void {
    this.mode = this.mode === 'grid' ? 'overview' : 'grid';
  }

  /**
   * Toggle the Workflow board on/off (its title-bar button / Cmd-Shift-K). Opening
   * it from overview or grid switches to 'workflow'; pressing it again while the
   * board is showing returns to the grid (where the focused pane lives).
   */
  toggleWorkflow(): void {
    this.mode = this.mode === 'workflow' ? 'grid' : 'workflow';
  }
}

/** The singleton view store, imported by the route + Overview + the toggle UI. */
export const view = new ViewStore();
