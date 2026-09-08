// `pointerReorder` — a Svelte action that makes the `[data-reorder-id]` rows inside
// a list node drag-to-reorderable with POINTER events. Why not HTML5 drag-and-drop:
// the app enables Tauri's native drag-drop (so files can be dropped onto sessions),
// and that OS-level handler swallows every in-page `dragstart`, leaving the HTML5
// DnD API dead app-wide. Pointer events are untouched by it.
//
// Usage:
//   <ul use:pointerReorder={{ onChange, onDrop }}>
//     <li data-reorder-id={id} …>
// `onChange(dragId, overId)` fires whenever the lifted row or the hovered drop
// target changes (both null when idle) so the component can style them;
// `onDrop(from, to)` fires when a drag is released over another row. A press that
// never crosses `DRAG_THRESHOLD_PX` is a normal click; a press that does becomes
// a drag and the click it would otherwise produce is suppressed.

import type { Action } from 'svelte/action';
import {
  IDLE_GESTURE,
  moveGesture,
  pressGesture,
  releaseGesture,
  type ReorderGesture
} from './reorderGesture';

export interface PointerReorderOptions {
  /** The lifted row and the current drop target changed (null/null when idle). */
  onChange?: (dragId: string | null, overId: string | null) => void;
  /** A drag was released over another row: move `from` to `to`'s slot. */
  onDrop: (from: string, to: string) => void;
  /** Hit-test override (defaults to `document.elementFromPoint`); injectable for
   *  tests, which run without a layout engine. */
  elementAt?: (x: number, y: number) => Element | null;
}

const ROW_SELECTOR = '[data-reorder-id]';

export const pointerReorder: Action<HTMLElement, PointerReorderOptions> = (node, options) => {
  let opts = options;
  let g: ReorderGesture = IDLE_GESTURE;
  let pressedEl: HTMLElement | null = null;
  let pointerId = -1;

  /** The reorder id of the row (inside `node`) containing `el`, else null. */
  function rowIdOf(el: Element | null): string | null {
    const row = el?.closest<HTMLElement>(ROW_SELECTOR) ?? null;
    if (!row || !node.contains(row)) return null;
    return row.dataset.reorderId ?? null;
  }

  function emit(next: ReorderGesture) {
    const prevDrag = g.dragging ? g.pressedId : null;
    const nextDrag = next.dragging ? next.pressedId : null;
    const changed = prevDrag !== nextDrag || g.overId !== next.overId;
    g = next;
    if (changed) opts.onChange?.(nextDrag, next.overId);
  }

  function reset() {
    if (pressedEl && pointerId >= 0) {
      try {
        pressedEl.releasePointerCapture(pointerId);
      } catch {
        /* not captured */
      }
    }
    node.style.userSelect = '';
    pressedEl = null;
    pointerId = -1;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
    emit(IDLE_GESTURE);
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0 || g.pressedId !== null) return;
    const row = (e.target as Element | null)?.closest<HTMLElement>(ROW_SELECTOR) ?? null;
    const id = rowIdOf(row);
    if (!row || id === null) return;
    pressedEl = row;
    pointerId = e.pointerId;
    g = pressGesture(id, e.clientX, e.clientY);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
  }

  function onMove(e: PointerEvent) {
    if (g.pressedId === null) return;
    const wasDragging = g.dragging;
    const hit = (opts.elementAt ?? ((x, y) => document.elementFromPoint(x, y)))(
      e.clientX,
      e.clientY
    );
    const next = moveGesture(g, e.clientX, e.clientY, rowIdOf(hit));
    if (next.dragging && !wasDragging) {
      // Drag begins: keep receiving the pointer even if it leaves the row/window,
      // and stop the drag from selecting text as it passes over labels.
      try {
        pressedEl?.setPointerCapture(pointerId);
      } catch {
        /* unsupported */
      }
      node.style.userSelect = 'none';
    }
    if (next.dragging) e.preventDefault();
    emit(next);
  }

  function onUp() {
    const { drop, wasDrag } = releaseGesture(g);
    if (wasDrag) suppressNextClick();
    reset();
    if (drop) opts.onDrop(drop.from, drop.to);
  }

  function onCancel() {
    reset();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && g.dragging) {
      e.preventDefault();
      reset();
    }
  }

  /** After a drag the browser still fires `click` on the row; swallow that one
   *  (capture phase, once) so a reorder never doubles as a row activation. */
  function suppressNextClick() {
    const swallow = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener('click', swallow, true);
      clearTimeout(timer);
    };
    window.addEventListener('click', swallow, true);
    // A drag released outside the window produces no click at all.
    const timer = setTimeout(cleanup, 0);
  }

  node.addEventListener('pointerdown', onDown);

  return {
    update(next: PointerReorderOptions) {
      opts = next;
    },
    destroy() {
      node.removeEventListener('pointerdown', onDown);
      reset();
    }
  };
};
