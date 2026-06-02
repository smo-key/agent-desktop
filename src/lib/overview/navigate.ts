// PURE navigation-target resolution for the agent-overview surface (Stage 3,
// tasks.md 10.6; spec: Navigate To An Agent). Given the live workspace list and a
// roster `paneId`, it resolves WHICH workspace owns that pane and WHICH leaf id
// carries it — the two values the live view switch needs:
//
//   setActiveWorkspace(target.workspaceId)
//   setFocusIn(target.workspaceId, target.leafId)
//   view.show('grid')
//
// The actual store mutation + view switch is LIVE (it touches the reactive
// workspace store and re-paints the grid), so it is confirmed MANUALLY in the
// running app. THIS module is the framework-free core that decides the target,
// so the "selecting an agent focuses its pane" logic is unit-tested here without a
// window: a pane id maps to exactly the {workspaceId, leafId} of the leaf that
// carries it, across every workspace, in tree order. A pane id that no live leaf
// carries (its session ended, or a stale roster row) resolves to `null` so the
// caller no-ops rather than focusing a dead pane.
//
// Framework-free: it reads a minimal projection of the tree (a recursive node
// with `paneId` on leaves), NOT the Svelte store, so the test needs no runtime.

/** A minimal structural node: a leaf carrying a `paneId`, or a split with kids.
 *  A superset-compatible projection of the layout tree's `Node` (the real `Leaf`
 *  also has `id`; the real `Split` also has `direction`/`ratios`) — we read only
 *  what target resolution needs, so the real tree nodes satisfy this directly. */
export type NavNode =
  | { type: 'leaf'; id: string; paneId: string }
  | { type: 'split'; children: NavNode[] };

/** One workspace, projected to exactly what navigation reads: its id + its tree. */
export interface NavWorkspace {
  /** The workspace id — becomes the navigate target's `workspaceId`. */
  id: string;
  /** The workspace's root node (leaves carry `paneId`). */
  root: NavNode;
}

/** The resolved navigation target: which workspace + leaf to focus. */
export interface NavTarget {
  /** The owning workspace id (pass to `setActiveWorkspace`/`setFocusIn`). */
  workspaceId: string;
  /** The structural leaf id carrying the pane (pass to `setFocusIn`). */
  leafId: string;
}

/**
 * Find the structural leaf id that carries `paneId` within one tree, in DFS
 * (tree) order, or null when no leaf does. Pure; reads, never mutates.
 */
function leafIdForPane(node: NavNode, paneId: string): string | null {
  if (node.type === 'leaf') return node.paneId === paneId ? node.id : null;
  for (const child of node.children) {
    const found = leafIdForPane(child, paneId);
    if (found) return found;
  }
  return null;
}

/**
 * PURE: resolve the navigation target for a roster `paneId` — the {workspaceId,
 * leafId} of the leaf that carries it. Searches every workspace in order and
 * returns the FIRST match (paneIds are unique per leaf, so there is at most one).
 * Returns `null` when no live leaf carries the pane (a stale roster row / ended
 * session) so the caller can no-op instead of focusing a dead pane.
 *
 * @param workspaces the live workspace projection (id + root tree)
 * @param paneId     the roster row's pane id (the snapshot key)
 */
export function navigateTarget(
  workspaces: readonly NavWorkspace[],
  paneId: string
): NavTarget | null {
  for (const ws of workspaces) {
    const leafId = leafIdForPane(ws.root, paneId);
    if (leafId) return { workspaceId: ws.id, leafId };
  }
  return null;
}
