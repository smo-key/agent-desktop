// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SurfaceSlot } from './surfaceSlot.svelte';

describe('SurfaceSlot', () => {
  it('starts with no target', () => {
    expect(new SurfaceSlot().target).toBe(null);
  });

  it('set() points the target at an element; clear() resets it', () => {
    const slot = new SurfaceSlot();
    const el = document.createElement('div');
    slot.set(el);
    expect(slot.target).toBe(el);
    slot.clear();
    expect(slot.target).toBe(null);
  });
});
