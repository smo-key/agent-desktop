import { describe, expect, it } from 'vitest';
import {
  closeLeaf,
  findLeaf,
  findParent,
  focusCyclic,
  focusDirectional,
  freshWorkspace,
  leavesInOrder,
  migrate,
  normalizeRatios,
  resizeAdjacent,
  splitLeaf,
  validateTree,
  type Leaf,
  type Node,
  type Rect,
  type Split,
  type Workspace
} from './tree';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic id factory: emits id-1, id-2, … so split/close output is
 * stable and assertable. Each test gets its own counter via `ids()`.
 */
function ids(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function leaf(id: string, paneId: string): Leaf {
  return { type: 'leaf', id, paneId };
}

function split(id: string, direction: 'row' | 'col', children: Node[], ratios: number[]): Split {
  return { type: 'split', id, direction, children, ratios };
}

/** Sum of an array, for ratio assertions. */
function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

// A single leaf root.
function oneLeaf(): Leaf {
  return leaf('L1', 'p1');
}

// A row split with two leaves [0.5, 0.5].
function rowOfTwo(): Split {
  return split('S1', 'row', [leaf('L1', 'p1'), leaf('L2', 'p2')], [0.5, 0.5]);
}

// ---------------------------------------------------------------------------
// Primitive helpers (findLeaf / findParent / normalizeRatios / leavesInOrder)
// ---------------------------------------------------------------------------

describe('tree primitives', () => {
  it('findLeaf locates a leaf by id and returns null when absent', () => {
    const root = rowOfTwo();
    expect(findLeaf(root, 'L2')).toEqual(leaf('L2', 'p2'));
    expect(findLeaf(root, 'nope')).toBeNull();
  });

  it('findParent returns the parent split and the child index', () => {
    const root = rowOfTwo();
    const fp = findParent(root, 'L2');
    expect(fp).not.toBeNull();
    expect(fp!.parent.id).toBe('S1');
    expect(fp!.index).toBe(1);
    // The root has no parent.
    expect(findParent(root, 'S1')).toBeNull();
  });

  it('normalizeRatios rescales any positive vector to sum 1', () => {
    expect(sum(normalizeRatios([1, 1, 2]))).toBeCloseTo(1, 10);
    expect(normalizeRatios([2, 2])).toEqual([0.5, 0.5]);
    // Degenerate all-zero input falls back to an even split.
    expect(normalizeRatios([0, 0, 0])).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('leavesInOrder yields leaves left-to-right in DFS order', () => {
    const root = split(
      'S1',
      'row',
      [leaf('A', 'pa'), split('S2', 'col', [leaf('B', 'pb'), leaf('C', 'pc')], [0.5, 0.5])],
      [0.5, 0.5]
    );
    expect(leavesInOrder(root).map((l) => l.id)).toEqual(['A', 'B', 'C']);
  });
});

// ---------------------------------------------------------------------------
// validateTree
// ---------------------------------------------------------------------------

describe('validateTree', () => {
  it('re-normalizes drifted ratios to sum 1', () => {
    const root = split('S1', 'row', [leaf('A', 'pa'), leaf('B', 'pb')], [3, 1]);
    const ws: Workspace = { version: 1, root, focusedId: 'A' };
    const v = validateTree(ws);
    const s = v.root as Split;
    expect(sum(s.ratios)).toBeCloseTo(1, 10);
    expect(s.ratios).toEqual([0.75, 0.25]);
  });

  it('collapses a split with fewer than two children', () => {
    const root = split('S1', 'row', [leaf('A', 'pa')], [1]);
    const ws: Workspace = { version: 1, root, focusedId: 'A' };
    const v = validateTree(ws);
    expect(v.root).toEqual(leaf('A', 'pa'));
  });

  it('repoints focusedId to the first leaf when it references no existing leaf', () => {
    const root = rowOfTwo();
    const ws: Workspace = { version: 1, root, focusedId: 'ghost' };
    const v = validateTree(ws);
    expect(v.focusedId).toBe('L1');
  });
});

// ---------------------------------------------------------------------------
// tiling-layout: Split A Pane Horizontally Or Vertically
// ---------------------------------------------------------------------------

describe('Split A Pane Horizontally Or Vertically', () => {
  it('Split a leaf into two equal panes', () => {
    const root = oneLeaf();
    const next = splitLeaf(root, 'L1', 'row', 'p-new', 'after', ids());
    expect(next.type).toBe('split');
    const s = next as Split;
    expect(s.direction).toBe('row');
    expect(s.children).toHaveLength(2);
    expect(s.ratios).toEqual([0.5, 0.5]);
    // Original leaf preserved (same id + paneId), new leaf carries the new paneId.
    expect((s.children[0] as Leaf).paneId).toBe('p1');
    expect((s.children[0] as Leaf).id).toBe('L1');
    expect((s.children[1] as Leaf).paneId).toBe('p-new');
    // The new leaf id came from the injected factory (deterministic).
    expect((s.children[1] as Leaf).id).toBe('id-1');
  });

  it('Splitting preserves the original terminal', () => {
    const root = oneLeaf();
    const next = splitLeaf(root, 'L1', 'col', 'p-new', 'after', ids());
    const original = findLeaf(next, 'L1');
    // Same leaf id and same paneId => xterm keyed on paneId is never remounted.
    expect(original).not.toBeNull();
    expect(original!.paneId).toBe('p1');
    // Input root is never mutated (purity).
    expect(root).toEqual(oneLeaf());
  });

  it('splits in column direction into a col Split', () => {
    const next = splitLeaf(oneLeaf(), 'L1', 'col', 'p-new', 'after', ids());
    expect((next as Split).direction).toBe('col');
  });

  it('honors where:before by inserting the new leaf ahead of the original', () => {
    const next = splitLeaf(oneLeaf(), 'L1', 'row', 'p-new', 'before', ids());
    const s = next as Split;
    expect((s.children[0] as Leaf).paneId).toBe('p-new');
    expect((s.children[1] as Leaf).paneId).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// tiling-layout: Same-Direction Split Flatten
// ---------------------------------------------------------------------------

describe('Same-Direction Split Flatten', () => {
  it('Repeated split right yields N even columns', () => {
    // Spec: after three such row-splits the Split has 3 children at [1/3,1/3,1/3]
    // — repeated same-direction splits flatten into N even siblings, not depth.
    const factory = ids();
    let root: Node = leaf('L1', 'p1');
    root = splitLeaf(root, 'L1', 'row', 'p2', 'after', factory); // -> 2 children
    root = splitLeaf(root, 'L1', 'row', 'p3', 'after', factory); // flatten -> 3
    const s = root as Split;
    expect(s.type).toBe('split');
    expect(s.direction).toBe('row');
    // No nested same-direction split: all children are leaves (flat).
    expect(s.children.every((c) => c.type === 'leaf')).toBe(true);
    expect(s.children).toHaveLength(3);
    for (const r of s.ratios) expect(r).toBeCloseTo(1 / 3, 10);
    expect(sum(s.ratios)).toBeCloseTo(1, 10);

    // One more split stays flat and even (4 evenly-sized quarters).
    root = splitLeaf(root, 'L1', 'row', 'p4', 'after', factory);
    const s2 = root as Split;
    expect(s2.children).toHaveLength(4);
    expect(s2.children.every((c) => c.type === 'leaf')).toBe(true);
    for (const r of s2.ratios) expect(r).toBeCloseTo(0.25, 10);
  });

  it('Cross-direction split nests as expected', () => {
    const factory = ids();
    let root: Node = leaf('L1', 'p1');
    root = splitLeaf(root, 'L1', 'row', 'p2', 'after', factory); // row split
    // Now split L1 in the OTHER direction -> a nested col split replaces L1.
    root = splitLeaf(root, 'L1', 'col', 'p3', 'after', factory);
    const s = root as Split;
    expect(s.direction).toBe('row');
    expect(s.children).toHaveLength(2); // still 2 children (no flatten)
    const first = s.children[0] as Split;
    expect(first.type).toBe('split');
    expect(first.direction).toBe('col'); // nested, different direction
    // Invariant: no Split directly contains a same-direction Split.
    expect(noSameDirectionNesting(root)).toBe(true);
  });
});

// Invariant helper used by flatten tests.
function noSameDirectionNesting(node: Node): boolean {
  if (node.type === 'leaf') return true;
  for (const c of node.children) {
    if (c.type === 'split' && c.direction === node.direction) return false;
    if (!noSameDirectionNesting(c)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// tiling-layout: Close A Pane With Collapse And Rebalance
// ---------------------------------------------------------------------------

describe('Close A Pane With Collapse And Rebalance', () => {
  it('Closing one of three panes normalizes remaining ratios', () => {
    const root = split(
      'S1',
      'row',
      [leaf('A', 'pa'), leaf('B', 'pb'), leaf('C', 'pc')],
      [0.5, 0.25, 0.25]
    );
    const ws: Workspace = { version: 1, root, focusedId: 'B' };
    const next = closeLeaf(ws, 'B');
    const s = next.root as Split;
    expect(s.children.map((c) => (c as Leaf).id)).toEqual(['A', 'C']);
    expect(sum(s.ratios)).toBeCloseTo(1, 10);
    // Focus resolved to a surviving leaf (the in-order neighbor) BEFORE returning.
    expect(leavesInOrder(next.root).some((l) => l.id === next.focusedId)).toBe(true);
  });

  it('Closing collapses a single-child parent upward', () => {
    // Outer row split: [ inner-col-split(A,B), C ].
    const inner = split('S2', 'col', [leaf('A', 'pa'), leaf('B', 'pb')], [0.5, 0.5]);
    const root = split('S1', 'row', [inner, leaf('C', 'pc')], [0.5, 0.5]);
    const ws: Workspace = { version: 1, root, focusedId: 'A' };
    // Closing B leaves the inner split with a single child A -> collapse up to A.
    const next = closeLeaf(ws, 'B');
    const s = next.root as Split;
    expect(s.children[0]).toEqual(leaf('A', 'pa')); // inner collapsed to its leaf
    expect((s.children[1] as Leaf).id).toBe('C');
    expect(sum(s.ratios)).toBeCloseTo(1, 10);
  });

  it('Closing a surviving sibling preserves its terminal', () => {
    const inner = split('S2', 'col', [leaf('A', 'pa'), leaf('B', 'pb')], [0.5, 0.5]);
    const root = split('S1', 'row', [inner, leaf('C', 'pc')], [0.5, 0.5]);
    const ws: Workspace = { version: 1, root, focusedId: 'B' };
    const next = closeLeaf(ws, 'B');
    // Surviving sibling A keeps the SAME paneId even though its parent collapsed.
    const a = findLeaf(next.root, 'A');
    expect(a).not.toBeNull();
    expect(a!.paneId).toBe('pa');
    // Input untouched (purity).
    expect(findLeaf(ws.root, 'B')).not.toBeNull();
  });

  it('collapses the root to its last leaf when everything but one closes', () => {
    const ws: Workspace = { version: 1, root: rowOfTwo(), focusedId: 'L1' };
    const next = closeLeaf(ws, 'L2');
    expect(next.root).toEqual(leaf('L1', 'p1'));
    expect(next.focusedId).toBe('L1');
  });
});

// ---------------------------------------------------------------------------
// tiling-layout: Drag-Resize A Gutter Adjusts Only Adjacent Siblings
// ---------------------------------------------------------------------------

describe('Drag-Resize A Gutter Adjusts Only Adjacent Siblings', () => {
  it('Gutter drag conserves the pair sum and freezes the rest', () => {
    const root = split(
      'S1',
      'row',
      [leaf('A', 'pa'), leaf('B', 'pb'), leaf('C', 'pc')],
      [0.4, 0.4, 0.2]
    );
    // Drag gutter between index 0 and 1 by +0.1.
    const next = resizeAdjacent(root, 'S1', 0, 0.1);
    const s = next as Split;
    expect(s.ratios[0]).toBeCloseTo(0.5, 10);
    expect(s.ratios[1]).toBeCloseTo(0.3, 10);
    // The non-adjacent ratio is frozen exactly.
    expect(s.ratios[2]).toBe(0.2);
    // Pair sum conserved.
    expect(s.ratios[0] + s.ratios[1]).toBeCloseTo(0.8, 10);
    // Input not mutated.
    expect((root as Split).ratios).toEqual([0.4, 0.4, 0.2]);
  });

  it('Gutter drag clamps to a minimum pane size', () => {
    const root = split('S1', 'row', [leaf('A', 'pa'), leaf('B', 'pb')], [0.5, 0.5]);
    // Try to drag far past the min in the negative direction.
    const next = resizeAdjacent(root, 'S1', 0, -0.9, 0.05);
    const s = next as Split;
    // ratios[0] is clamped to the min, the pair sum (1.0) is preserved.
    expect(s.ratios[0]).toBeCloseTo(0.05, 10);
    expect(s.ratios[1]).toBeCloseTo(0.95, 10);
    expect(s.ratios[0] + s.ratios[1]).toBeCloseTo(1, 10);
    // And the opposite over-drag clamps the other side.
    const next2 = resizeAdjacent(root, 'S1', 0, 0.9, 0.05);
    const s2 = next2 as Split;
    expect(s2.ratios[1]).toBeCloseTo(0.05, 10);
    expect(s2.ratios[0]).toBeCloseTo(0.95, 10);
  });

  it('resizeAdjacent is a no-op when the pair is too small to honor the minimum', () => {
    // The adjacent pair sums to exactly 2*minRatio (0.06 with minRatio 0.03), so
    // any move would push one side below the minimum. The clamp range inverts
    // (lo > hi), so resizeAdjacent must return the tree UNCHANGED rather than
    // clamp into the inverted range.
    const root = split(
      'S1',
      'row',
      [leaf('A', 'pa'), leaf('B', 'pb'), leaf('C', 'pc')],
      [0.03, 0.03, 0.94]
    );
    const next = resizeAdjacent(root, 'S1', 0, 0.5, 0.03) as Split;
    // Ratios are exactly preserved (no clamp, no inverted range).
    expect(next.ratios).toEqual([0.03, 0.03, 0.94]);

    // Also a no-op in the negative drag direction.
    const next2 = resizeAdjacent(root, 'S1', 0, -0.5, 0.03) as Split;
    expect(next2.ratios).toEqual([0.03, 0.03, 0.94]);

    // The input tree itself is never mutated.
    expect((root as Split).ratios).toEqual([0.03, 0.03, 0.94]);
  });
});

// ---------------------------------------------------------------------------
// tiling-layout: Focus Navigation By Click And Keyboard
// ---------------------------------------------------------------------------

describe('Focus Navigation By Click And Keyboard', () => {
  it('Click sets focus', () => {
    // Click is modeled as setting focusedId directly; validateTree keeps it valid.
    const ws: Workspace = { version: 1, root: rowOfTwo(), focusedId: 'L1' };
    const clicked: Workspace = { ...ws, focusedId: 'L2' };
    const v = validateTree(clicked);
    expect(v.focusedId).toBe('L2');
  });

  it('Cyclic focus wraps around', () => {
    const root = split(
      'S1',
      'row',
      [leaf('A', 'pa'), leaf('B', 'pb'), leaf('C', 'pc')],
      [1 / 3, 1 / 3, 1 / 3]
    );
    // next from last wraps to first.
    expect(focusCyclic(root, 'C', 'next')).toBe('A');
    // prev from first wraps to last.
    expect(focusCyclic(root, 'A', 'prev')).toBe('C');
    // Normal step.
    expect(focusCyclic(root, 'A', 'next')).toBe('B');
    expect(focusCyclic(root, 'B', 'prev')).toBe('A');
  });

  it('Directional focus picks the spatial neighbor', () => {
    const root = split('S1', 'row', [leaf('A', 'pa'), leaf('B', 'pb')], [0.5, 0.5]);
    const rects = new Map<string, Rect>([
      ['A', { x: 0, y: 0, width: 100, height: 100 }],
      ['B', { x: 100, y: 0, width: 100, height: 100 }]
    ]);
    // From A, focus-right reaches B.
    expect(focusDirectional(root, 'A', 'right', rects)).toBe('B');
    // From B, focus-left reaches A.
    expect(focusDirectional(root, 'B', 'left', rects)).toBe('A');
    // No pane above => focus unchanged.
    expect(focusDirectional(root, 'A', 'up', rects)).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// tiling-layout: Terminal Identity Preserved On Restructure
// ---------------------------------------------------------------------------

describe('Terminal Identity Preserved On Restructure', () => {
  it('paneId is stable across every structural operation', () => {
    const factory = ids('struct');
    // Split, then close, and assert L1's paneId never changes while node ids churn.
    let root: Node = leaf('L1', 'p1');
    const afterSplit = splitLeaf(root, 'L1', 'row', 'p2', 'after', factory);
    const newSplitId = (afterSplit as Split).id;
    expect(findLeaf(afterSplit, 'L1')!.paneId).toBe('p1');

    // Split again (cross-direction) to create a fresh structural node id.
    const afterSplit2 = splitLeaf(afterSplit, 'L1', 'col', 'p3', 'after', factory);
    // A NEW structural node id was generated for the nesting split (id churns).
    const nestedId = (findParent(afterSplit2, 'L1')!.parent as Split).id;
    expect(nestedId).not.toBe(newSplitId);
    // paneId is untouched by the restructure.
    expect(findLeaf(afterSplit2, 'L1')!.paneId).toBe('p1');

    // Close p3's leaf, collapsing structure; L1's paneId must remain stable.
    const ws: Workspace = { version: 1, root: afterSplit2, focusedId: 'L1' };
    const p3leaf = leavesInOrder(afterSplit2).find((l) => l.paneId === 'p3')!;
    const afterClose = closeLeaf(ws, p3leaf.id);
    expect(findLeaf(afterClose.root, 'L1')!.paneId).toBe('p1');
  });

  it('Restructure never detaches the PTY or loses scrollback', () => {
    // Model: a paneId surviving a restructure means xterm stays mounted (PTY kept).
    // We assert the SET of surviving paneIds is preserved across split + close.
    const factory = ids();
    let root: Node = leaf('L1', 'p1');
    root = splitLeaf(root, 'L1', 'row', 'p2', 'after', factory);
    root = splitLeaf(root, 'L1', 'row', 'p3', 'after', factory);
    const beforePanes = new Set(leavesInOrder(root).map((l) => l.paneId));
    expect(beforePanes).toEqual(new Set(['p1', 'p2', 'p3']));

    // Close p2; p1 and p3 must survive with identical paneIds (no remount).
    const ws: Workspace = { version: 1, root, focusedId: 'p2-leaf' };
    const targetId = leavesInOrder(root).find((l) => l.paneId === 'p2')!.id;
    const after = closeLeaf({ ...ws, focusedId: targetId }, targetId);
    const afterPanes = new Set(leavesInOrder(after.root).map((l) => l.paneId));
    expect(afterPanes).toEqual(new Set(['p1', 'p3']));
    // Every surviving paneId existed before => its xterm was never remounted.
    for (const p of afterPanes) expect(beforePanes.has(p)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// layout-persistence (pure parts)
// ---------------------------------------------------------------------------

describe('Serialize Workspace Layout And Session Registry', () => {
  it('Layout tree and registry serialized to JSON', () => {
    const factory = ids();
    let root: Node = leaf('L1', 'p1');
    root = splitLeaf(root, 'L1', 'row', 'p2', 'after', factory);
    const ws: Workspace = { version: 1, root, focusedId: 'L1' };
    // A session registry maps paneId -> {cwd, shell} for every leaf in the tree.
    const registry: Record<string, { cwd: string; shell: string }> = {};
    for (const l of leavesInOrder(ws.root)) {
      registry[l.paneId] = { cwd: `/work/${l.paneId}`, shell: '/bin/zsh' };
    }
    const payload = { workspace: ws, registry };

    // Round-trips losslessly through JSON.
    const restored = JSON.parse(JSON.stringify(payload)) as typeof payload;
    expect(restored.workspace).toEqual(ws);
    expect(restored.workspace.version).toBe(1);
    // Every leaf paneId has a {cwd, shell} entry; no process/pid/args recorded.
    for (const l of leavesInOrder(restored.workspace.root)) {
      expect(restored.registry[l.paneId]).toEqual({
        cwd: `/work/${l.paneId}`,
        shell: '/bin/zsh'
      });
      expect(Object.keys(restored.registry[l.paneId]).sort()).toEqual(['cwd', 'shell']);
    }
  });
});

describe('Restore With Invariant Validation', () => {
  it('Ratios normalized on restore', () => {
    // Structurally valid but ratios drift (sum != 1) => validateTree normalizes.
    const root = split('S1', 'col', [leaf('A', 'pa'), leaf('B', 'pb')], [2, 6]);
    const ws: Workspace = { version: 1, root, focusedId: 'A' };
    const v = validateTree(ws);
    const s = v.root as Split;
    expect(sum(s.ratios)).toBeCloseTo(1, 10);
    expect(s.ratios).toEqual([0.25, 0.75]);
  });

  it('Invariant violation is treated as invalid', () => {
    // focusedId references no existing leaf => validateTree repairs it (drift fix),
    // and a <2-child split is collapsed. Both are observable repairs.
    const badFocus: Workspace = { version: 1, root: rowOfTwo(), focusedId: 'ghost' };
    const repaired = validateTree(badFocus);
    expect(leavesInOrder(repaired.root).some((l) => l.id === repaired.focusedId)).toBe(true);

    const oneChild: Workspace = {
      version: 1,
      root: split('S1', 'row', [leaf('A', 'pa')], [1]),
      focusedId: 'A'
    };
    const collapsed = validateTree(oneChild);
    expect(collapsed.root.type).toBe('leaf');
  });
});

describe('Version-Keyed Migration', () => {
  it('Older version migrated forward', () => {
    // A v0 blob (no `version`, root under `tree`, focus under `focus`) migrates to v1.
    const v0 = {
      version: 0,
      tree: { type: 'leaf', id: 'L1', paneId: 'p1' },
      focus: 'L1'
    };
    const ws = migrate(v0);
    expect(ws.version).toBe(1);
    expect(ws.root).toEqual(leaf('L1', 'p1'));
    expect(ws.focusedId).toBe('L1');
    // Already-current v1 input passes through (still validated).
    const v1: Workspace = { version: 1, root: rowOfTwo(), focusedId: 'L1' };
    expect(migrate(v1)).toEqual(validateTree(v1));
  });

  it('Unmigratable version is rejected', () => {
    // A future / unknown version has no migration path -> migrate throws.
    expect(() => migrate({ version: 999, root: oneLeaf(), focusedId: 'L1' })).toThrow();
  });
});

describe('Graceful Fallback On Corrupt State', () => {
  it('Corrupt JSON falls back to fresh workspace', () => {
    // The caller's restore wrapper: try migrate; on any throw, freshWorkspace().
    function restore(raw: string, freshPaneId: string): Workspace {
      try {
        return migrate(JSON.parse(raw));
      } catch {
        return freshWorkspace(freshPaneId);
      }
    }
    const fresh = restore('{ this is not json', 'p-fresh');
    expect(fresh.version).toBe(1);
    expect(fresh.root.type).toBe('leaf');
    expect((fresh.root as Leaf).paneId).toBe('p-fresh');
    expect(fresh.focusedId).toBe((fresh.root as Leaf).id);

    // Structurally corrupt (but parseable) also falls back.
    const fresh2 = restore(JSON.stringify({ version: 1, root: null, focusedId: 'x' }), 'p2');
    expect(fresh2.root.type).toBe('leaf');
    expect((fresh2.root as Leaf).paneId).toBe('p2');
  });

  it('Missing layout file falls back to fresh workspace', () => {
    // No file => freshWorkspace directly.
    const ws = freshWorkspace('p-only');
    expect(ws.version).toBe(1);
    expect(ws.root).toEqual({ type: 'leaf', id: (ws.root as Leaf).id, paneId: 'p-only' });
    expect(ws.focusedId).toBe((ws.root as Leaf).id);
    // freshWorkspace passes validateTree (it is a valid single-leaf workspace).
    expect(validateTree(ws)).toEqual(ws);
  });
});
