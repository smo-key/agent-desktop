// A live registry of each leaf's on-screen pixel rectangle, keyed by leaf `id`.
// `PaneNode` writes into it on mount/resize; the route reads it to drive
// `focusDirectional` (spatial neighbor selection). Kept out of the workspace
// store because it's pure view geometry, not topology — it must never trigger a
// structural recompute, so it's a plain Map (no runes) read on demand.

import type { Rect } from './tree';

const rectMap = new Map<string, Rect>();

/** Record/refresh a leaf's pixel rect. */
export function setRect(leafId: string, rect: Rect) {
  rectMap.set(leafId, rect);
}

/** Forget a leaf's rect (on unmount). */
export function clearRect(leafId: string) {
  rectMap.delete(leafId);
}

/** A snapshot of the current rects for `focusDirectional`. */
export function rectsSnapshot(): Map<string, Rect> {
  return new Map(rectMap);
}
