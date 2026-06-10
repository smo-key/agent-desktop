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

// The help modal must show EVERY shortcut a user can actually trigger. This pins
// each functional binding registered by a handler (the global onKeydown in
// +page.svelte, the inbox nav in Inbox.svelte, the launcher's keys) so the
// registry can't silently drift out of sync with them. Inert grid-only bindings
// (⌘[, ⌘], Alt+Arrow, the grid ⌘W) are excluded on purpose — `if (!view.isGrid)
// return;` never passes in the inbox view, so they never fire.
describe('shortcuts registry covers every functional binding', () => {
  const FUNCTIONAL: Array<{ keys: string[]; where: string }> = [
    { keys: ['⌘', 'N'], where: 'new session' },
    { keys: ['⌘', 'T'], where: 'create task' },
    { keys: ['⌘', 'J'], where: 'toggle terminals panel' },
    { keys: ['⌘', 'Y'], where: 'new terminal' },
    { keys: ['⌘', 'Tab'], where: 'cycle focus' },
    { keys: ['⌘', '/'], where: 'show shortcuts' },
    { keys: ['?'], where: 'show shortcuts (bare ?)' },
    { keys: ['Esc'], where: 'close dialog' },
    { keys: ['⌘', '↓'], where: 'next agent' },
    { keys: ['⌘', '↑'], where: 'previous agent' },
    { keys: ['⌘', '⇧', '↓'], where: 'next project filter' },
    { keys: ['⌘', '⇧', '↑'], where: 'previous project filter' },
    { keys: ['⌘', 'W'], where: 'archive session' },
    { keys: ['⌘', '.'], where: 'pause / resume session' },
    { keys: ['⌘', 'O'], where: 'insert file path into terminal' },
    { keys: ['⌘', 'Enter'], where: 'confirm and launch' }
  ];

  const has = (keys: string[]): boolean =>
    allItems().some(
      (s) => s.keys.length === keys.length && s.keys.every((k, i) => k === keys[i])
    );

  for (const { keys, where } of FUNCTIONAL) {
    it(`lists ${keys.join('')} (${where})`, () => {
      expect(has(keys)).toBe(true);
    });
  }
});
