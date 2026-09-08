import { describe, expect, it } from 'vitest';
import { SHORTCUTS, shortcutGroups, type Shortcut } from './shortcuts';
import { resolveBindings } from './keybindings';

// Tests for the keyboard-shortcut REGISTRY — what the help modal renders. It is
// derived from the rebindable definitions (keybindings.ts) plus the fixed keys, so
// these guard both the registry's shape and that every functional binding is
// documented at its default chord.

const allItems = (groups = SHORTCUTS): Shortcut[] => groups.flatMap((g) => g.items);
const has = (keys: string[], groups = SHORTCUTS): boolean =>
  allItems(groups).some((s) => s.keys.length === keys.length && s.keys.every((k, i) => k === keys[i]));
const section = (title: string, groups = SHORTCUTS) => groups.find((g) => g.title === title);

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

// The help modal must show EVERY shortcut a user can actually trigger, at its
// current chord. Inert grid-only bindings (⌘[, ⌘], Alt+Arrow, the grid ⌘W) are
// excluded on purpose — `if (!view.isGrid) return;` never passes in the inbox view.
describe('help modal lists every functional keyboard shortcut', () => {
  it('Global shortcuts are listed', () => {
    const g = section('Global');
    expect(g).toBeDefined();
    const labels = g!.items.map((i) => [i.keys.join(''), i.label]);
    expect(labels).toContainEqual(['⌘N', 'New session']);
    expect(labels).toContainEqual(['⌘⇧N', 'New session in a git worktree']);
    expect(labels).toContainEqual(['⌘T', 'Create task']);
    expect(labels).toContainEqual(['⌘J', 'Toggle Terminals panel']);
    expect(labels).toContainEqual(['⌘Y', 'New terminal']);
    expect(labels).toContainEqual(['⌘Tab', 'Cycle focus (agent / terminals)']);
    expect(labels).toContainEqual(['⌘/', 'Show keyboard shortcuts']);
    expect(has(['?'], [g!])).toBe(true);
    expect(has(['Esc'], [g!])).toBe(true);
  });

  it('Inbox shortcuts are listed', () => {
    const g = section('Inbox')!;
    expect(has(['⌘', '↓'], [g])).toBe(true);
    expect(has(['⌘', '↑'], [g])).toBe(true);
    expect(has(['⌘', '⇧', '↓'], [g])).toBe(true);
    expect(has(['⌘', '⇧', '↑'], [g])).toBe(true);
  });

  it('Session and launcher shortcuts are listed', () => {
    const s = section('Session')!;
    expect(has(['⌘', 'W'], [s])).toBe(true);
    expect(has(['⌘', '.'], [s])).toBe(true);
    expect(has(['⌘', 'O'], [s])).toBe(true);
    expect(has(['⌘', 'I'], [s])).toBe(false);
    const l = section('Launcher')!;
    expect(has(['⌘', 'Enter'], [l])).toBe(true);
    expect(has(['Esc'], [l])).toBe(true);
  });

  it('Inert grid-only bindings are not listed', () => {
    expect(has(['⌘', '['])).toBe(false);
    expect(has(['⌘', ']'])).toBe(false);
    for (const arrow of ['↑', '↓', '←', '→']) expect(has(['⌥', arrow])).toBe(false);
    // ⌘W appears once (the inbox archive), never as the grid close-pane.
    expect(allItems().filter((s) => s.keys.join('') === '⌘W')).toHaveLength(1);
  });

  it('Help modal reflects a custom binding', () => {
    const groups = shortcutGroups(
      resolveBindings({ newSession: { key: 'K', meta: true, ctrl: false, alt: false, shift: true } })
    );
    const row = section('Global', groups)!.items.find((i) => i.label === 'New session')!;
    expect(row.keys).toEqual(['⌘', '⇧', 'K']);
    expect(has(['⌘', 'N'], groups)).toBe(false);
  });
});
