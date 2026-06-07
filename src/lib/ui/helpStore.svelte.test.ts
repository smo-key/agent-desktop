import { describe, expect, it } from 'vitest';
import { HelpStore } from './helpStore.svelte';

// Tests for the help-modal open/close latch. Named `*.svelte.test.ts` so vitest
// compiles the `$state` rune. Mirrors the launcher store's thin show/close/toggle
// shape — the modal reads `help.open` to render.

describe('help store', () => {
  it('starts closed', () => {
    expect(new HelpStore().open).toBe(false);
  });

  it('show() opens and is idempotent; close() closes', () => {
    const h = new HelpStore();
    h.show();
    expect(h.open).toBe(true);
    h.show();
    expect(h.open).toBe(true);
    h.close();
    expect(h.open).toBe(false);
  });

  it('toggle() flips open state', () => {
    const h = new HelpStore();
    h.toggle();
    expect(h.open).toBe(true);
    h.toggle();
    expect(h.open).toBe(false);
  });
});
