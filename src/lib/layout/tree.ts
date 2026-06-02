// Pure, framework-free pane-tree model + operations for the tiling layout.
//
// This module owns the serializable topology described in design.md D4/D8 and
// the tiling-layout / layout-persistence specs. EVERY operation here is PURE:
// it returns a brand-new tree (structurally cloned where it changes) and never
// mutates its inputs. Structural node ids are produced by an INJECTED id factory
// so callers (and tests) get deterministic output independent of any
// nondeterministic id/time source.
//
// Invariants enforced (see validateTree):
//   - For every Split: ratios.length === children.length and sum(ratios) ≈ 1.
//   - A Split always has ≥ 2 children (1 ⇒ collapse to that child).
//   - No Split directly contains a same-direction Split (splitLeaf flattens).
//   - focusedId references an existing Leaf.
//
// The xterm instance is keyed on the stable `paneId` (never regenerated), so
// splitting/closing/collapsing/reparenting a pane never remounts it. These ops
// only ever create/destroy structural node `id`s and Leaf wrappers — a Leaf's
// `paneId` is carried verbatim through every restructure.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Direction = 'row' | 'col';

export interface Leaf {
  type: 'leaf';
  id: string;
  paneId: string;
}

export interface Split {
  type: 'split';
  id: string;
  direction: Direction;
  children: Node[];
  ratios: number[];
}

export type Node = Leaf | Split;

export interface Workspace {
  version: 1;
  root: Node;
  focusedId: string;
}

/** Where a new sibling lands relative to the split target. */
export type SplitWhere = 'before' | 'after';

/** Cyclic focus direction over leavesInOrder (DFS ±1). */
export type CyclicDir = 'next' | 'prev';

/** Directional (spatial) focus direction. */
export type SpatialDir = 'left' | 'right' | 'up' | 'down';

/** A pixel rectangle for a pane, used by focusDirectional. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Injected, deterministic id factory for fresh structural node ids. */
export type IdFactory = () => string;

// Default minimum ratio a pane may be shrunk to during a gutter drag.
const DEFAULT_MIN_RATIO = 0.05;

// ---------------------------------------------------------------------------
// Internal: structural cloning (never mutate inputs)
// ---------------------------------------------------------------------------

function cloneNode(node: Node): Node {
  if (node.type === 'leaf') {
    return { type: 'leaf', id: node.id, paneId: node.paneId };
  }
  return {
    type: 'split',
    id: node.id,
    direction: node.direction,
    children: node.children.map(cloneNode),
    ratios: node.ratios.slice()
  };
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

/** Find a Leaf by its `id`, or null. Pure read; returns a reference into `node`. */
export function findLeaf(node: Node, leafId: string): Leaf | null {
  if (node.type === 'leaf') return node.id === leafId ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, leafId);
    if (found) return found;
  }
  return null;
}

/**
 * Find the parent Split of the node with `childId`, plus that child's index.
 * Returns null when `childId` is the root or is absent.
 */
export function findParent(
  node: Node,
  childId: string
): { parent: Split; index: number } | null {
  if (node.type === 'leaf') return null;
  for (let i = 0; i < node.children.length; i++) {
    if (node.children[i].id === childId) return { parent: node, index: i };
    const deeper = findParent(node.children[i], childId);
    if (deeper) return deeper;
  }
  return null;
}

/**
 * Rescale a positive ratio vector so it sums to 1. An all-zero (or empty-ish)
 * vector degrades to an even split, never NaN.
 */
export function normalizeRatios(ratios: number[]): number[] {
  const total = ratios.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (total <= 0) {
    const n = ratios.length || 1;
    return ratios.length ? ratios.map(() => 1 / n) : [];
  }
  return ratios.map((r) => (r > 0 ? r : 0) / total);
}

/** Leaves in left-to-right (DFS) order. */
export function leavesInOrder(node: Node): Leaf[] {
  if (node.type === 'leaf') return [node];
  const out: Leaf[] = [];
  for (const child of node.children) out.push(...leavesInOrder(child));
  return out;
}

// ---------------------------------------------------------------------------
// validateTree
// ---------------------------------------------------------------------------

/**
 * Re-assert and REPAIR every invariant, returning a new valid Workspace:
 *   - re-normalize each Split's ratios to sum 1 (right-sizing the vector to the
 *     child count if they disagree),
 *   - collapse any Split left with < 2 children to its single child (recursively),
 *   - ensure focusedId references an existing Leaf, else pick the first leaf.
 * Throws if the tree is structurally unusable (e.g. no leaves at all).
 */
export function validateTree(ws: Workspace): Workspace {
  const root = validateNode(cloneNode(ws.root));
  const leaves = leavesInOrder(root);
  if (leaves.length === 0) {
    throw new Error('validateTree: tree contains no leaves');
  }
  const focusedId = leaves.some((l) => l.id === ws.focusedId)
    ? ws.focusedId
    : leaves[0].id;
  return { version: 1, root, focusedId };
}

/** Recursively repair a node; collapse degenerate splits up. */
function validateNode(node: Node): Node {
  if (node.type === 'leaf') return node;

  // Repair children first (bottom-up), dropping any null/garbage child.
  const children = node.children
    .filter((c): c is Node => !!c && (c.type === 'leaf' || c.type === 'split'))
    .map(validateNode);

  // Collapse a split with fewer than 2 children to its single child (or, if it
  // somehow has none, this is unreachable for a well-formed tree — guard anyway).
  if (children.length === 1) return children[0];
  if (children.length === 0) {
    throw new Error('validateTree: split with no usable children');
  }

  // Right-size and re-normalize ratios to the (possibly changed) child count.
  let ratios = node.ratios.slice(0, children.length);
  while (ratios.length < children.length) ratios.push(1 / children.length);
  ratios = normalizeRatios(ratios);

  return { type: 'split', id: node.id, direction: node.direction, children, ratios };
}

// ---------------------------------------------------------------------------
// splitLeaf — with same-direction flatten
// ---------------------------------------------------------------------------

/**
 * Split the leaf `leafId` in `direction`, giving the new leaf `newPaneId`.
 *
 * Same-direction flatten: if the leaf's parent Split already has `direction`,
 * insert the new leaf as a sibling at `index ± 1` (per `where`) and split that
 * one slot's ratio in two — so repeated splits in one direction produce N
 * EVENLY-sized cells, never nested depth. Otherwise replace the leaf in place
 * with a fresh 2-child Split `[oldLeaf, newLeaf]` at `[0.5, 0.5]` (order per
 * `where`).
 *
 * Pure: returns a new root; the original leaf keeps its id AND paneId.
 */
export function splitLeaf(
  root: Node,
  leafId: string,
  direction: Direction,
  newPaneId: string,
  where: SplitWhere,
  newId: IdFactory
): Node {
  const cloned = cloneNode(root);

  const target = findLeaf(cloned, leafId);
  if (!target) return cloned; // unknown leaf: no-op (pure clone)

  const newLeaf: Leaf = { type: 'leaf', id: newId(), paneId: newPaneId };
  const parentInfo = findParent(cloned, leafId);

  // Same-direction flatten: parent exists and matches `direction`.
  if (parentInfo && parentInfo.parent.direction === direction) {
    const { parent, index } = parentInfo;
    const insertAt = where === 'after' ? index + 1 : index;
    const slot = parent.ratios[index];
    const half = slot / 2;
    parent.children.splice(insertAt, 0, newLeaf);
    // The original slot ratio is split in two between the pair, keeping the
    // rest of the vector untouched, then the whole vector is renormalized so
    // the invariant sum≈1 holds (it already does, but this is defensive).
    parent.ratios.splice(index, 1, half, half);
    // Re-balance so repeated same-direction splits yield EVEN cells: even out
    // the children of this split. (Spec: N splits => 1/N each.)
    parent.ratios = evenRatios(parent.children.length);
    return cloned;
  }

  // Cross-direction (or root leaf): replace the leaf with a new 2-child Split.
  const replacement: Split = {
    type: 'split',
    id: newId(),
    direction,
    children: where === 'after' ? [target, newLeaf] : [newLeaf, target],
    ratios: [0.5, 0.5]
  };

  if (!parentInfo) {
    // The target was the root leaf.
    return replacement;
  }
  parentInfo.parent.children[parentInfo.index] = replacement;
  return cloned;
}

/** An even ratio vector of length n (sums to 1). */
function evenRatios(n: number): number[] {
  if (n <= 0) return [];
  return Array.from({ length: n }, () => 1 / n);
}

// ---------------------------------------------------------------------------
// closeLeaf — remove, collapse single-child parent up, normalize, resolve focus
// ---------------------------------------------------------------------------

/**
 * Close the leaf `leafId`: remove it from its parent Split, normalize the
 * remaining sibling ratios, and collapse any parent left with a single child by
 * replacing it with that child (recursively up). Focus is resolved to an
 * in-order neighbor of the closed leaf BEFORE returning.
 *
 * Pure: returns a new Workspace; surviving leaves keep their paneId.
 */
export function closeLeaf(ws: Workspace, leafId: string): Workspace {
  // Resolve the focus target FIRST, against the ORIGINAL tree, so we can pick
  // the closed leaf's in-order neighbor even after the structure changes.
  const order = leavesInOrder(ws.root);
  const closingIndex = order.findIndex((l) => l.id === leafId);

  const cloned = cloneNode(ws.root);
  const parentInfo = findParent(cloned, leafId);

  // Closing the only leaf (root is the leaf itself): no-op, keep as-is.
  if (!parentInfo) {
    return { version: 1, root: cloned, focusedId: ws.focusedId };
  }

  const { parent, index } = parentInfo;
  parent.children.splice(index, 1);
  parent.ratios.splice(index, 1);
  parent.ratios = normalizeRatios(parent.ratios);

  // Collapse single-child splits up the chain. We re-run validateNode-style
  // collapsing over the whole tree for a clean, recursive result.
  const collapsedRoot = collapseSingleChildren(cloned);

  // Resolve focus to an in-order neighbor of the closed leaf among survivors.
  const survivors = leavesInOrder(collapsedRoot);
  let focusedId = ws.focusedId;
  if (!survivors.some((l) => l.id === focusedId)) {
    focusedId = pickNeighborFocus(order, closingIndex, survivors);
  }

  return { version: 1, root: collapsedRoot, focusedId };
}

/** Recursively replace any Split that has exactly one child with that child. */
function collapseSingleChildren(node: Node): Node {
  if (node.type === 'leaf') return node;
  const children = node.children.map(collapseSingleChildren);
  if (children.length === 1) return children[0];
  return {
    type: 'split',
    id: node.id,
    direction: node.direction,
    children,
    ratios: normalizeRatios(node.ratios.slice(0, children.length))
  };
}

/**
 * Pick the surviving leaf nearest (in original in-order position) to the closed
 * leaf: prefer the next leaf, else the previous, else the first survivor.
 */
function pickNeighborFocus(
  originalOrder: Leaf[],
  closingIndex: number,
  survivors: Leaf[]
): string {
  const survivorIds = new Set(survivors.map((l) => l.id));
  // Look forward from the closed slot.
  for (let i = closingIndex + 1; i < originalOrder.length; i++) {
    if (survivorIds.has(originalOrder[i].id)) return originalOrder[i].id;
  }
  // Then backward.
  for (let i = closingIndex - 1; i >= 0; i--) {
    if (survivorIds.has(originalOrder[i].id)) return originalOrder[i].id;
  }
  return survivors[0].id;
}

// ---------------------------------------------------------------------------
// resizeAdjacent — gutter drag adjusts only the two adjacent ratios
// ---------------------------------------------------------------------------

/**
 * Adjust the gutter between children `gutterIndex` and `gutterIndex + 1` of the
 * Split `splitId` by `deltaRatio`: ratios[i] += delta, ratios[i+1] -= delta.
 * The pair sum is conserved; every other ratio in the entire tree is frozen.
 * Both adjacent ratios are clamped so neither drops below `minRatio`.
 *
 * Pure: returns a new root.
 */
export function resizeAdjacent(
  root: Node,
  splitId: string,
  gutterIndex: number,
  deltaRatio: number,
  minRatio: number = DEFAULT_MIN_RATIO
): Node {
  const cloned = cloneNode(root);
  const split = findSplit(cloned, splitId);
  if (!split) return cloned;

  const i = gutterIndex;
  const j = gutterIndex + 1;
  if (i < 0 || j >= split.ratios.length) return cloned;

  const a = split.ratios[i];
  const b = split.ratios[j];
  const pairSum = a + b;

  // Degenerate guard: if the pair is too small to honor the minimum on BOTH sides
  // (pairSum <= 2*minRatio), the clamp range [minRatio, pairSum - minRatio]
  // inverts (lo > hi) and any clamp would push a pane BELOW minRatio. There is no
  // valid move, so return the tree UNCHANGED (a no-op resize) rather than clamp
  // into an inverted range.
  if (pairSum <= 2 * minRatio) return cloned;

  // Clamp the new value of ratios[i] into [minRatio, pairSum - minRatio] so
  // neither side crosses the minimum and the pair sum is exactly conserved.
  const lo = minRatio;
  const hi = pairSum - minRatio;
  let nextA = a + deltaRatio;
  if (nextA < lo) nextA = lo;
  if (nextA > hi) nextA = hi;
  const nextB = pairSum - nextA;

  split.ratios[i] = nextA;
  split.ratios[j] = nextB;
  return cloned;
}

/** Find a Split by id (returns a reference into the given tree). */
function findSplit(node: Node, splitId: string): Split | null {
  if (node.type === 'leaf') return null;
  if (node.id === splitId) return node;
  for (const child of node.children) {
    const found = findSplit(child, splitId);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Focus navigation
// ---------------------------------------------------------------------------

/**
 * Cyclic focus over leavesInOrder: 'next' moves +1 (wraps to first), 'prev'
 * moves -1 (wraps to last). Returns the resolved focused leaf id (or the
 * current id unchanged when it isn't in the tree).
 */
export function focusCyclic(root: Node, currentId: string, dir: CyclicDir): string {
  const order = leavesInOrder(root);
  if (order.length === 0) return currentId;
  const idx = order.findIndex((l) => l.id === currentId);
  if (idx === -1) return order[0].id;
  const n = order.length;
  const next = dir === 'next' ? (idx + 1) % n : (idx - 1 + n) % n;
  return order[next].id;
}

/**
 * Directional (spatial) focus using a caller-provided rect map (leafId -> Rect,
 * in pixels). Picks the nearest leaf whose rectangle lies in the requested
 * direction from the current leaf's rectangle. Returns the current id unchanged
 * when there is no candidate in that direction.
 */
export function focusDirectional(
  root: Node,
  currentId: string,
  dir: SpatialDir,
  rects: Map<string, Rect>
): string {
  const current = rects.get(currentId);
  if (!current) return currentId;

  const cx = current.x + current.width / 2;
  const cy = current.y + current.height / 2;

  let best: { id: string; primary: number; secondary: number } | null = null;

  for (const leaf of leavesInOrder(root)) {
    if (leaf.id === currentId) continue;
    const r = rects.get(leaf.id);
    if (!r) continue;
    const rx = r.x + r.width / 2;
    const ry = r.y + r.height / 2;

    // The candidate must be strictly on the requested side. `primary` is the
    // distance along the move axis; `secondary` is the off-axis misalignment.
    let primary: number;
    let secondary: number;
    switch (dir) {
      case 'right':
        if (rx <= cx) continue;
        primary = rx - cx;
        secondary = Math.abs(ry - cy);
        break;
      case 'left':
        if (rx >= cx) continue;
        primary = cx - rx;
        secondary = Math.abs(ry - cy);
        break;
      case 'down':
        if (ry <= cy) continue;
        primary = ry - cy;
        secondary = Math.abs(rx - cx);
        break;
      case 'up':
        if (ry >= cy) continue;
        primary = cy - ry;
        secondary = Math.abs(rx - cx);
        break;
    }

    // Prefer the smallest off-axis misalignment, then the nearest along-axis.
    if (
      !best ||
      secondary < best.secondary ||
      (secondary === best.secondary && primary < best.primary)
    ) {
      best = { id: leaf.id, primary, secondary };
    }
  }

  return best ? best.id : currentId;
}

// ---------------------------------------------------------------------------
// Workspace construction, migration, fallback
// ---------------------------------------------------------------------------

/** Current schema version. */
export const CURRENT_VERSION = 1 as const;

/** A fresh single-leaf workspace wrapping `paneId`. Always valid. */
export function freshWorkspace(paneId: string, newId: IdFactory = defaultIdFactory): Workspace {
  const leafId = newId();
  return {
    version: 1,
    root: { type: 'leaf', id: leafId, paneId },
    focusedId: leafId
  };
}

/**
 * Version-keyed migration: upgrade a parsed, untrusted blob to the CURRENT
 * schema version, then validate it. Throws when the input is unusable or its
 * version has no migration path (callers catch this and fall back to
 * freshWorkspace — see "Graceful Fallback On Corrupt State").
 */
export function migrate(obj: unknown): Workspace {
  if (obj === null || typeof obj !== 'object') {
    throw new Error('migrate: not an object');
  }
  const blob = obj as Record<string, unknown>;
  const version = typeof blob.version === 'number' ? blob.version : 0;

  let current: Record<string, unknown> = blob;
  let v = version;

  // Run forward migrations in sequence until we reach CURRENT_VERSION.
  while (v < CURRENT_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`migrate: no migration path from version ${v}`);
    current = step(current);
    v += 1;
  }

  if (v !== CURRENT_VERSION) {
    throw new Error(`migrate: unmigratable version ${version}`);
  }

  // Validate (and repair) the migrated structure into a real Workspace.
  return validateTree(asWorkspace(current));
}

/** A single forward migration step: version N -> N+1. */
type Migration = (blob: Record<string, unknown>) => Record<string, unknown>;

// MIGRATIONS[N] upgrades a version-N blob to version N+1. Add new entries here
// as the schema evolves; an absent entry means "unmigratable from N".
const MIGRATIONS: Record<number, Migration> = {
  // v0 -> v1: the pre-versioned shape stored the tree under `tree` and the
  // focused leaf under `focus`; lift them into `root`/`focusedId` and stamp v1.
  0: (blob) => ({
    version: 1,
    root: blob.root ?? blob.tree,
    focusedId: blob.focusedId ?? blob.focus
  })
};

/** Coerce a migrated blob into a Workspace shape (validateTree does the rest). */
function asWorkspace(blob: Record<string, unknown>): Workspace {
  const root = blob.root as Node | undefined;
  if (!root || (root.type !== 'leaf' && root.type !== 'split')) {
    throw new Error('migrate: missing or invalid root');
  }
  const focusedId = typeof blob.focusedId === 'string' ? blob.focusedId : '';
  return { version: 1, root, focusedId };
}

// A non-deterministic default id factory for production callers that don't
// inject one (tests always inject a deterministic factory). Kept tiny and
// dependency-free; collisions are astronomically unlikely for node ids.
let counter = 0;
function defaultIdFactory(): string {
  counter += 1;
  return `n${Date.now().toString(36)}${counter.toString(36)}`;
}
