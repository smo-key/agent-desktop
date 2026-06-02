import { describe, expect, it } from 'vitest';
import { navigateTarget, type NavWorkspace } from './navigate';

// Tests for the PURE navigation-target resolver (Stage 3 of agent-overview). The
// `it(...)` title is the EXACT `#### Scenario:` name from the agent-overview spec
// (Requirement: Navigate To An Agent) so the scenario-coverage gate maps it here.
// The actual store mutation + view switch is LIVE/MANUAL; this asserts the pure
// "which workspace + which leaf carries this pane" decision the live code drives.

/** A single-leaf workspace whose one leaf carries `paneId` under leaf `leafId`. */
function leafWs(id: string, leafId: string, paneId: string): NavWorkspace {
  return { id, root: { type: 'leaf', id: leafId, paneId } };
}

describe('navigate — Navigate To An Agent', () => {
  it('Selecting an agent focuses its pane', () => {
    // Two workspaces; the second has a split with the target pane on its right
    // leaf. Selecting that agent must resolve to ITS workspace + ITS leaf id.
    const workspaces: NavWorkspace[] = [
      leafWs('ws-1', 'leaf-a', 'pane-a'),
      {
        id: 'ws-2',
        root: {
          type: 'split',
          children: [
            { type: 'leaf', id: 'leaf-b', paneId: 'pane-b' },
            { type: 'leaf', id: 'leaf-c', paneId: 'pane-c' }
          ]
        }
      }
    ];

    expect(navigateTarget(workspaces, 'pane-a')).toEqual({
      workspaceId: 'ws-1',
      leafId: 'leaf-a'
    });
    // The nested pane resolves to its OWN workspace + leaf, not the first one.
    expect(navigateTarget(workspaces, 'pane-c')).toEqual({
      workspaceId: 'ws-2',
      leafId: 'leaf-c'
    });
  });

  it('Navigating to a pane no live leaf carries is null', () => {
    const workspaces = [leafWs('ws-1', 'leaf-a', 'pane-a')];
    // A stale roster row / ended session: no leaf carries it -> null (caller no-ops).
    expect(navigateTarget(workspaces, 'pane-gone')).toBeNull();
    expect(navigateTarget([], 'pane-a')).toBeNull();
  });
});
