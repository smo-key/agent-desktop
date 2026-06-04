import { describe, expect, it } from 'vitest';
import { ViewStore } from './view.svelte';

// Tests for the top-level view-mode store (Stage 3 of agent-overview). The
// `it(...)` title is the EXACT `#### Scenario:` name from the agent-overview spec
// (Requirement: Overview As A Primary View) so the scenario-coverage gate maps it
// here. Named `*.svelte.test.ts` so vitest compiles the `$state` rune. The actual
// conditional render in `+page.svelte` is LIVE/MANUAL; this asserts the pure
// transition logic the route drives.

describe('view — Overview As A Primary View', () => {
  it('Switch between the overview and grid views', () => {
    const v = new ViewStore();

    // Defaults to the card overview (mission control) — the user spends most
    // time here.
    expect(v.mode).toBe('overview');
    expect(v.isOverview).toBe(true);
    expect(v.isGrid).toBe(false);

    // Cycling toggles overview <-> grid.
    v.cycle();
    expect(v.mode).toBe('grid');
    expect(v.isGrid).toBe(true);
    expect(v.isOverview).toBe(false);

    v.cycle();
    expect(v.mode).toBe('overview');
    expect(v.isOverview).toBe(true);

    // show() sets an explicit view (e.g. "dig in" lands on the grid).
    v.show('grid');
    expect(v.mode).toBe('grid');
    v.show('grid'); // idempotent
    expect(v.mode).toBe('grid');
    v.show('overview');
    expect(v.mode).toBe('overview');
  });
});
