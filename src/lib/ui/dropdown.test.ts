import { describe, expect, it } from 'vitest';

import { rovingIndex } from './dropdown';

describe('rovingIndex', () => {
  it('keyboard navigation moves through the options', () => {
    // Down/Up step by one…
    expect(rovingIndex(0, 'ArrowDown', 4)).toBe(1);
    expect(rovingIndex(2, 'ArrowUp', 4)).toBe(1);
    // …and clamp at the ends (no wrap).
    expect(rovingIndex(3, 'ArrowDown', 4)).toBe(3);
    expect(rovingIndex(0, 'ArrowUp', 4)).toBe(0);
    // Home/End jump to the first/last option.
    expect(rovingIndex(2, 'Home', 4)).toBe(0);
    expect(rovingIndex(1, 'End', 4)).toBe(3);
    // A non-navigation key leaves the highlight unchanged.
    expect(rovingIndex(1, 'Enter', 4)).toBe(1);
    // No options → nothing to highlight.
    expect(rovingIndex(0, 'ArrowDown', 0)).toBe(-1);
  });
});
