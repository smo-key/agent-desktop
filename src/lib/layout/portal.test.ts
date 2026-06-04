// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { portal } from './portal';

function setup() {
  const home = document.createElement('div');
  const node = document.createElement('section');
  node.textContent = 'surface';
  home.appendChild(node);
  const target = document.createElement('div');
  document.body.append(home, target);
  return { home, node, target };
}

describe('portal action', () => {
  it('moves the node into the target on mount', () => {
    const { node, target } = setup();
    portal(node, target);
    expect(node.parentElement).toBe(target);
  });

  it('returns the node home when the target becomes null', () => {
    const { home, node, target } = setup();
    const action = portal(node, target);
    expect(node.parentElement).toBe(target);
    action.update(null);
    expect(node.parentElement).toBe(home);
  });

  it('re-targets when the target changes', () => {
    const { node, target } = setup();
    const other = document.createElement('div');
    document.body.appendChild(other);
    const action = portal(node, target);
    action.update(other);
    expect(node.parentElement).toBe(other);
  });

  it('restores the node to its home parent on destroy', () => {
    const { home, node, target } = setup();
    const action = portal(node, target);
    action.destroy();
    expect(node.parentElement).toBe(home);
  });

  it('keeps the node home when the initial target is null', () => {
    const { home, node } = setup();
    portal(node, null);
    expect(node.parentElement).toBe(home);
  });

  it('is a no-op when re-targeted to the same element (node stays put)', () => {
    const { node, target } = setup();
    const action = portal(node, target);
    const before = node.parentElement;
    action.update(target);
    expect(node.parentElement).toBe(before);
    expect(node.parentElement).toBe(target);
  });
});
