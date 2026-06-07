import { describe, expect, it } from 'vitest';
import { SHORTCUTS, type Shortcut } from './shortcuts';

// Tests for the keyboard-shortcut REGISTRY — the single source of truth the help
// modal renders. These guard the registry's shape so a malformed entry (an empty
// label, a shortcut with no keys, a duplicate combo) is caught at test time rather
// than rendering a blank/garbled row.

const allItems = (): Shortcut[] => SHORTCUTS.flatMap((g) => g.items);

describe('shortcuts registry', () => {
  it('has at least one group, each with a non-empty title and items', () => {
    expect(SHORTCUTS.length).toBeGreaterThan(0);
    for (const group of SHORTCUTS) {
      expect(group.title.trim()).not.toBe('');
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it('every shortcut has a non-empty label and at least one key', () => {
    for (const item of allItems()) {
      expect(item.label.trim()).not.toBe('');
      expect(item.keys.length).toBeGreaterThan(0);
      for (const k of item.keys) expect(k.trim()).not.toBe('');
    }
  });

  it('has no duplicate key-combos within a group', () => {
    for (const group of SHORTCUTS) {
      const combos = group.items.map((i) => i.keys.join('+'));
      expect(new Set(combos).size).toBe(combos.length);
    }
  });

  it('documents the shortcut that opens this very modal', () => {
    const combos = allItems().map((i) => i.keys.join('+'));
    expect(combos).toContain('⌘+/');
  });
});
