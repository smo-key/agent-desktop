// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { autofocus } from './autofocus';

// The `use:autofocus` action moves keyboard focus to a dialog's first control as
// soon as it mounts (dialogs are `{#if}`-mounted, so mount === open). By default
// it focuses the node it is attached to; with `{ within: true }` it focuses the
// first focusable DESCENDANT, for containers whose controls come from children /
// snippets (e.g. the footer popover).

afterEach(() => {
  document.body.innerHTML = '';
});

describe('autofocus action', () => {
  it('focuses the node it is attached to on mount', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    autofocus(btn);

    expect(document.activeElement).toBe(btn);
  });

  it('with { within: true } focuses the first focusable descendant', () => {
    const panel = document.createElement('div');
    panel.tabIndex = -1; // the container itself is not a tab stop
    const first = document.createElement('button');
    const second = document.createElement('button');
    panel.append(first, second);
    document.body.appendChild(panel);

    autofocus(panel, { within: true });

    expect(document.activeElement).toBe(first);
  });

  it('with { within: true } skips disabled controls', () => {
    const panel = document.createElement('div');
    const disabled = document.createElement('button');
    disabled.disabled = true;
    const enabled = document.createElement('button');
    panel.append(disabled, enabled);
    document.body.appendChild(panel);

    autofocus(panel, { within: true });

    expect(document.activeElement).toBe(enabled);
  });

  it('with { within: true } treats role="button" tabindex="0" rows as focusable', () => {
    // Mirrors FooterPopover: the body's list rows are focusable before the pinned
    // action button, so the first row gets focus.
    const panel = document.createElement('div');
    const row = document.createElement('li');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    const action = document.createElement('button');
    panel.append(row, action);
    document.body.appendChild(panel);

    autofocus(panel, { within: true });

    expect(document.activeElement).toBe(row);
  });

  it('with { within: true } falls back to nothing extra when no descendant is focusable', () => {
    const panel = document.createElement('div');
    panel.tabIndex = -1;
    panel.appendChild(document.createElement('span'));
    document.body.appendChild(panel);

    // Should not throw, and must not steal focus to the (non-focusable) container.
    expect(() => autofocus(panel, { within: true })).not.toThrow();
    expect(document.activeElement).not.toBe(panel);
  });

  it('does nothing when { enabled: false }', () => {
    const a = document.createElement('button');
    const b = document.createElement('button');
    document.body.append(a, b);
    b.focus(); // pretend focus already sits elsewhere

    autofocus(a, { enabled: false });

    expect(document.activeElement).toBe(b); // unchanged
  });

  it('focuses when { enabled: true }', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    autofocus(btn, { enabled: true });

    expect(document.activeElement).toBe(btn);
  });

  it('returns an action object with a no-op destroy', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    const action = autofocus(btn);

    expect(typeof action?.destroy).toBe('function');
    expect(() => action?.destroy?.()).not.toThrow();
  });
});
