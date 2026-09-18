// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionReturn } from 'svelte/action';
import { pointerReorder, type PointerReorderOptions } from './pointerReorder';
import { DRAG_THRESHOLD_PX } from './reorderGesture';

// DOM tests for the `pointerReorder` action: rows tagged `data-reorder-id` inside
// the action's node can be pressed, dragged (past the threshold) over another row,
// and released to call `onDrop(from, to)`. The hit-test is injected (`elementAt`)
// because jsdom has no `elementFromPoint`. A plain click must still reach the row.

function setup(opts: Partial<PointerReorderOptions> = {}) {
  const list = document.createElement('div');
  const rows = ['a', 'b', 'c'].map((id) => {
    const r = document.createElement('div');
    r.dataset.reorderId = id;
    r.setPointerCapture = vi.fn();
    r.releasePointerCapture = vi.fn();
    list.appendChild(r);
    return r;
  });
  document.body.appendChild(list);
  const onChange = vi.fn();
  const onDrop = vi.fn();
  // Hit-test: whichever row the test has "placed" under the pointer.
  let under: Element | null = null;
  // `Action`'s declared return is `void | ActionReturn`; `pointerReorder` always
  // returns the teardown object, so narrow it here rather than guarding at every
  // call site (`action.destroy` is otherwise a type error on the `void` arm).
  const action = pointerReorder(list, {
    onChange,
    onDrop,
    elementAt: () => under,
    ...opts
  }) as ActionReturn<PointerReorderOptions>;
  return {
    list,
    rows,
    onChange,
    onDrop,
    setUnder(el: Element | null) {
      under = el;
    },
    destroy: () => action.destroy?.()
  };
}

function ptr(type: string, target: Element, x: number, y: number, init: PointerEventInit = {}) {
  const e = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: 1,
    ...init
  });
  target.dispatchEvent(e);
  return e;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('pointerReorder', () => {
  it('press, drag past the threshold onto another row, release → onDrop(from, to)', () => {
    const t = setup();
    const [a, b] = t.rows;
    ptr('pointerdown', a, 10, 10);
    t.setUnder(b);
    ptr('pointermove', a, 10, 10 + DRAG_THRESHOLD_PX + 2);
    expect(t.onChange).toHaveBeenLastCalledWith('a', 'b');
    ptr('pointerup', a, 10, 30);
    expect(t.onDrop).toHaveBeenCalledWith('a', 'b');
    // Idle again.
    expect(t.onChange).toHaveBeenLastCalledWith(null, null);
    t.destroy();
  });

  it('a drag suppresses the click that follows it, a plain click passes through', () => {
    const t = setup();
    const [a, b] = t.rows;
    const clicked = vi.fn();
    a.addEventListener('click', clicked);

    ptr('pointerdown', a, 0, 0);
    t.setUnder(b);
    ptr('pointermove', a, 50, 0);
    ptr('pointerup', a, 50, 0);
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicked).not.toHaveBeenCalled();

    ptr('pointerdown', a, 0, 0);
    ptr('pointermove', a, 1, 0);
    ptr('pointerup', a, 1, 0);
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(t.onDrop).toHaveBeenCalledTimes(1);
    t.destroy();
  });

  it('releasing over nothing, or over the pressed row, drops nothing', () => {
    const t = setup();
    const [a] = t.rows;
    ptr('pointerdown', a, 0, 0);
    t.setUnder(a);
    ptr('pointermove', a, 50, 0);
    expect(t.onChange).toHaveBeenLastCalledWith('a', null);
    ptr('pointerup', a, 50, 0);
    expect(t.onDrop).not.toHaveBeenCalled();
    t.destroy();
  });

  it('Escape cancels an in-progress drag', () => {
    const t = setup();
    const [a, b] = t.rows;
    ptr('pointerdown', a, 0, 0);
    t.setUnder(b);
    ptr('pointermove', a, 50, 0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(t.onChange).toHaveBeenLastCalledWith(null, null);
    ptr('pointerup', a, 50, 0);
    expect(t.onDrop).not.toHaveBeenCalled();
    t.destroy();
  });

  it('ignores secondary buttons and presses outside a row', () => {
    const t = setup();
    const [a, b] = t.rows;
    ptr('pointerdown', a, 0, 0, { button: 2 });
    t.setUnder(b);
    ptr('pointermove', a, 50, 0);
    ptr('pointerup', a, 50, 0, { button: 2 });
    expect(t.onDrop).not.toHaveBeenCalled();

    ptr('pointerdown', t.list, 0, 0);
    ptr('pointermove', t.list, 50, 0);
    ptr('pointerup', t.list, 50, 0);
    expect(t.onDrop).not.toHaveBeenCalled();
    expect(t.onChange).not.toHaveBeenCalled();
    t.destroy();
  });

  it('only rows inside the action node count as drop targets', () => {
    const t = setup();
    const [a] = t.rows;
    const stranger = document.createElement('div');
    stranger.dataset.reorderId = 'z';
    document.body.appendChild(stranger);
    ptr('pointerdown', a, 0, 0);
    t.setUnder(stranger);
    ptr('pointermove', a, 50, 0);
    expect(t.onChange).toHaveBeenLastCalledWith('a', null);
    ptr('pointerup', a, 50, 0);
    expect(t.onDrop).not.toHaveBeenCalled();
    t.destroy();
  });

  it('destroy removes the listeners', () => {
    const t = setup();
    const [a, b] = t.rows;
    t.destroy();
    ptr('pointerdown', a, 0, 0);
    t.setUnder(b);
    ptr('pointermove', a, 50, 0);
    ptr('pointerup', a, 50, 0);
    expect(t.onDrop).not.toHaveBeenCalled();
  });
});
