import { describe, expect, it } from 'vitest';
import { ViewStore } from './view.svelte';

// Tests for the top-level view-mode store (Stage 3 of agent-overview). The
// `it(...)` title is the EXACT `#### Scenario:` name from the agent-overview spec
// (Requirement: Overview As A Primary View) so the scenario-coverage gate maps it
// here. Named `*.svelte.test.ts` so vitest compiles the `$state` rune. The actual
// conditional render in `+page.svelte` is LIVE/MANUAL; this asserts the pure
// transition logic the route drives.

describe('view — Overview As A Primary View', () => {
  it('Toggle between overview and grid', () => {
    const v = new ViewStore();

    // Defaults to the overview (mission control) — the user spends most time here.
    expect(v.mode).toBe('overview');
    expect(v.isOverview).toBe(true);
    expect(v.isGrid).toBe(false);

    // Toggling alternates the two surfaces.
    v.toggle();
    expect(v.mode).toBe('grid');
    expect(v.isGrid).toBe(true);
    expect(v.isOverview).toBe(false);

    v.toggle();
    expect(v.mode).toBe('overview');

    // show() sets an explicit view (e.g. selecting an agent lands on the grid).
    v.show('grid');
    expect(v.mode).toBe('grid');
    v.show('grid'); // idempotent
    expect(v.mode).toBe('grid');
    v.show('overview');
    expect(v.mode).toBe('overview');
  });

  // workflow-board STAGE 2: the third surface. Reached via its own toggle, NOT the
  // two-way overview<->grid alternation.
  it('Toggle the workflow board independently of overview/grid', () => {
    const v = new ViewStore();
    expect(v.isWorkflow).toBe(false);

    // toggleWorkflow opens the board from any surface...
    v.toggleWorkflow();
    expect(v.mode).toBe('workflow');
    expect(v.isWorkflow).toBe(true);
    expect(v.isOverview).toBe(false);
    expect(v.isGrid).toBe(false);

    // ...and pressing it again returns to the grid (where the focused pane lives).
    v.toggleWorkflow();
    expect(v.mode).toBe('grid');

    // The overview<->grid toggle stays exactly two-way and never reaches workflow.
    v.show('workflow');
    v.toggle();
    expect(v.mode).toBe('grid'); // from workflow, toggle drops back into the grid
    v.toggle();
    expect(v.mode).toBe('overview');
    v.toggle();
    expect(v.mode).toBe('grid');

    // show() can still set workflow explicitly (idempotent).
    v.show('workflow');
    expect(v.mode).toBe('workflow');
    v.show('workflow');
    expect(v.mode).toBe('workflow');
  });
});
