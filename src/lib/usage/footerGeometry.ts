// PURE geometry helper for the footer's right-zone alignment. Given a workspace
// pane tree and a predicate identifying the "terminal" pane(s), it computes the
// LEFT EDGE of the terminal area as a fraction [0,1] of the surface width — by
// walking the same split ratios the tiling layout uses. Framework-free (no
// Svelte/Tauri), so it is unit-tested in footerGeometry.test.ts. The footer reads
// this reactively (a gutter drag commits a new tree) to keep its right group's
// left edge aligned under the terminal pane as panes resize.

import type { Node } from '../layout/tree';

/**
 * The smallest left-edge x-fraction [0,1] among all leaves whose `paneId`
 * satisfies `isTerminal` — i.e. the left edge of the terminal AREA within the
 * surface. Returns null when no leaf matches. A `row` split partitions its
 * x-range by `ratios`; a `col` split shares the parent x-range (children stack
 * vertically). The root spans the full [0,1].
 */
export function terminalLeftFraction(
  root: Node,
  isTerminal: (paneId: string) => boolean
): number | null {
  let best: number | null = null;

  function walk(node: Node, x0: number, x1: number): void {
    if (node.type === 'leaf') {
      if (isTerminal(node.paneId)) best = best === null ? x0 : Math.min(best, x0);
      return;
    }
    if (node.direction === 'row') {
      const span = x1 - x0;
      let acc = x0;
      for (let i = 0; i < node.children.length; i++) {
        const w = span * (node.ratios[i] ?? 0);
        walk(node.children[i], acc, acc + w);
        acc += w;
      }
    } else {
      // Column split: children stack vertically and share the x-range.
      for (const child of node.children) walk(child, x0, x1);
    }
  }

  walk(root, 0, 1);
  return best;
}
