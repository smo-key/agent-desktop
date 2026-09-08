// PURE pointer drag-to-reorder gesture. The app runs inside Tauri with native
// drag-drop ENABLED (for dropping files onto sessions), and that OS-level handler
// swallows every in-page HTML5 `dragstart`, so list reordering cannot use the
// HTML5 DnD API. Pointer events are unaffected, so reorder is modelled as a plain
// press → move-past-threshold → release gesture. This module is the state
// machine; `pointerReorder.ts` binds it to the DOM.

/** How far (px) the pointer must travel from the press before it counts as a
 *  drag rather than a click. */
export const DRAG_THRESHOLD_PX = 4;

export interface ReorderGesture {
  /** The row pressed on (its reorder id), or null when idle. */
  readonly pressedId: string | null;
  readonly startX: number;
  readonly startY: number;
  /** True once the pointer has moved past `DRAG_THRESHOLD_PX`. */
  readonly dragging: boolean;
  /** The row currently hovered as a drop target — never `pressedId`, and only
   *  ever set while dragging. */
  readonly overId: string | null;
}

export const IDLE_GESTURE: ReorderGesture = Object.freeze({
  pressedId: null,
  startX: 0,
  startY: 0,
  dragging: false,
  overId: null
});

/** Start a gesture: the primary button went down on row `id` at (x, y). */
export function pressGesture(id: string, x: number, y: number): ReorderGesture {
  return { pressedId: id, startX: x, startY: y, dragging: false, overId: null };
}

/** The pointer moved to (x, y) while row `overId` (or nothing) is under it. Starts
 *  dragging past the threshold; while dragging, tracks the hovered row as the
 *  drop target (excluding the pressed row itself). */
export function moveGesture(
  g: ReorderGesture,
  x: number,
  y: number,
  overId: string | null
): ReorderGesture {
  if (g.pressedId === null) return g;
  const dragging =
    g.dragging || Math.hypot(x - g.startX, y - g.startY) >= DRAG_THRESHOLD_PX;
  if (!dragging) return g;
  const target = overId !== null && overId !== g.pressedId ? overId : null;
  return { ...g, dragging: true, overId: target };
}

/** The pointer was released. `drop` is the move to apply (or null); `wasDrag`
 *  tells the caller whether to suppress the click that follows a drag. */
export function releaseGesture(g: ReorderGesture): {
  drop: { from: string; to: string } | null;
  wasDrag: boolean;
} {
  if (g.pressedId === null || !g.dragging) return { drop: null, wasDrag: false };
  const drop = g.overId !== null ? { from: g.pressedId, to: g.overId } : null;
  return { drop, wasDrag: true };
}
