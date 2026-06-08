// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tooltip } from './tooltip';

// The `use:tooltip` action shows a single, body-portaled, styled hint for any
// element. These tests drive it through real DOM events (jsdom) with fake timers
// so the hover delay is deterministic. "Visible" = a [role="tooltip"] node is
// present in <body>; "hidden" = it is gone.

function popup(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="tooltip"]');
}

function mount(param: Parameters<typeof tooltip>[1]) {
  const node = document.createElement('button');
  document.body.appendChild(node);
  const action = tooltip(node, param);
  return { node, action };
}

describe('tooltip action', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows the hint text on hover after the delay', () => {
    const { node } = mount('Launch agent');

    node.dispatchEvent(new Event('mouseenter'));
    expect(popup()).toBeNull(); // not yet — still inside the delay

    vi.advanceTimersByTime(300);

    expect(popup()?.textContent).toBe('Launch agent');
  });

  it('hides again on mouseleave', () => {
    const { node } = mount('Stop task');
    node.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(300);
    expect(popup()).not.toBeNull();

    node.dispatchEvent(new Event('mouseleave'));

    expect(popup()).toBeNull();
  });

  it('cancels a pending hover if the pointer leaves before the delay', () => {
    const { node } = mount('Edit task');
    node.dispatchEvent(new Event('mouseenter'));
    node.dispatchEvent(new Event('mouseleave'));

    vi.advanceTimersByTime(300);

    expect(popup()).toBeNull();
  });

  it('shows immediately on keyboard focus (no delay)', () => {
    const { node } = mount('Collapse projects');

    node.dispatchEvent(new FocusEvent('focusin'));

    expect(popup()?.textContent).toBe('Collapse projects');
  });

  it('does not show on focus that follows a pointer press (a click)', () => {
    const { node } = mount('Remove task');

    node.dispatchEvent(new Event('pointerdown'));
    node.dispatchEvent(new FocusEvent('focusin'));

    expect(popup()).toBeNull();
  });

  it('hides on Escape', () => {
    const { node } = mount('Branch main');
    node.dispatchEvent(new FocusEvent('focusin'));
    expect(popup()).not.toBeNull();

    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(popup()).toBeNull();
  });

  it('accepts an options object with a placement', () => {
    const { node } = mount({ text: 'Collapse projects', placement: 'right' });

    node.dispatchEvent(new FocusEvent('focusin'));

    expect(popup()?.textContent).toBe('Collapse projects');
    expect(popup()?.dataset.placement).toBe('right');
  });

  it('update() changes the text shown on the next hover', () => {
    const { node, action } = mount('old');
    action.update('new');

    node.dispatchEvent(new FocusEvent('focusin'));

    expect(popup()?.textContent).toBe('new');
  });

  it('update() retargets the live tooltip while it is visible', () => {
    const { node, action } = mount('old');
    node.dispatchEvent(new FocusEvent('focusin'));
    expect(popup()?.textContent).toBe('old');

    action.update('updated');

    expect(popup()?.textContent).toBe('updated');
  });

  it('destroy() hides the tooltip and detaches listeners', () => {
    const { node, action } = mount('Close session');
    node.dispatchEvent(new FocusEvent('focusin'));
    expect(popup()).not.toBeNull();

    action.destroy();
    expect(popup()).toBeNull();

    // No longer reacts to events.
    node.dispatchEvent(new FocusEvent('focusin'));
    expect(popup()).toBeNull();
  });

  it('marks the tooltip aria-hidden so it never double-speaks aria-label', () => {
    const { node } = mount('Launch agent');
    node.dispatchEvent(new FocusEvent('focusin'));

    expect(popup()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('reuses a single tooltip element across instances', () => {
    const a = mount('first');
    const b = mount('second');

    a.node.dispatchEvent(new FocusEvent('focusin'));
    const firstEl = popup();
    a.node.dispatchEvent(new Event('mouseleave'));
    a.node.dispatchEvent(new FocusEvent('focusout'));

    b.node.dispatchEvent(new FocusEvent('focusin'));
    const secondEl = popup();

    expect(secondEl?.textContent).toBe('second');
    // Same singleton node, just retargeted/re-shown.
    expect(secondEl).toBe(firstEl);
  });
});
