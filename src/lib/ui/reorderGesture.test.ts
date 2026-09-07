import { describe, expect, it } from 'vitest';

// Tests for the PURE pointer drag-to-reorder gesture state machine: a press on a
// row, movement past a small threshold turns into a drag, the hovered row (never
// the pressed one) becomes the drop target, and release yields the move.

import {
  DRAG_THRESHOLD_PX,
  IDLE_GESTURE,
  pressGesture,
  moveGesture,
  releaseGesture,
  type ReorderGesture
} from './reorderGesture';

describe('reorderGesture', () => {
  it('a press records the row and origin without dragging', () => {
    const g = pressGesture('a', 10, 20);
    expect(g).toEqual({ pressedId: 'a', startX: 10, startY: 20, dragging: false, overId: null });
  });

  it('movement inside the threshold does not start a drag', () => {
    const g = moveGesture(pressGesture('a', 10, 20), 10 + DRAG_THRESHOLD_PX - 1, 20, 'b');
    expect(g.dragging).toBe(false);
    expect(g.overId).toBeNull();
  });

  it('movement past the threshold starts the drag and tracks the hovered row', () => {
    const g = moveGesture(pressGesture('a', 10, 20), 10, 20 + DRAG_THRESHOLD_PX, 'b');
    expect(g.dragging).toBe(true);
    expect(g.overId).toBe('b');
  });

  it('the pressed row is never its own drop target', () => {
    const g = moveGesture(pressGesture('a', 0, 0), 50, 0, 'a');
    expect(g.dragging).toBe(true);
    expect(g.overId).toBeNull();
  });

  it('once dragging, a small move keeps dragging and updates the target', () => {
    let g = moveGesture(pressGesture('a', 0, 0), 50, 0, 'b');
    g = moveGesture(g, 51, 0, 'c');
    expect(g.dragging).toBe(true);
    expect(g.overId).toBe('c');
    g = moveGesture(g, 52, 0, null);
    expect(g.overId).toBeNull();
  });

  it('moving with nothing pressed is a no-op', () => {
    expect(moveGesture(IDLE_GESTURE, 100, 100, 'b')).toBe(IDLE_GESTURE);
  });

  it('release after a drag over another row yields the move', () => {
    const g = moveGesture(pressGesture('a', 0, 0), 50, 0, 'b');
    expect(releaseGesture(g)).toEqual({ drop: { from: 'a', to: 'b' }, wasDrag: true });
  });

  it('release after a drag over nothing (or itself) yields no move but was a drag', () => {
    const g: ReorderGesture = moveGesture(pressGesture('a', 0, 0), 50, 0, null);
    expect(releaseGesture(g)).toEqual({ drop: null, wasDrag: true });
  });

  it('release without a drag is a plain click (no move, not a drag)', () => {
    const g = moveGesture(pressGesture('a', 0, 0), 1, 1, 'b');
    expect(releaseGesture(g)).toEqual({ drop: null, wasDrag: false });
    expect(releaseGesture(IDLE_GESTURE)).toEqual({ drop: null, wasDrag: false });
  });

  it('never mutates the input gesture', () => {
    const p = pressGesture('a', 0, 0);
    const snapshot = { ...p };
    moveGesture(p, 50, 0, 'b');
    releaseGesture(p);
    expect(p).toEqual(snapshot);
  });
});
