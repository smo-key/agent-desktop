import { describe, expect, it } from 'vitest';
import {
  SHORTCUT_DEFS,
  chordFromEvent,
  chordMatches,
  defaultBindings,
  findConflict,
  formatChord,
  formatChordText,
  isRecordableChord,
  parseChord,
  parseOverrides,
  resolveBindings,
  type KeyChord,
  type KeyEventLike
} from './keybindings';

function ev(key: string, mods: Partial<Omit<KeyEventLike, 'key'>> = {}): KeyEventLike {
  return {
    key,
    metaKey: mods.metaKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false
  };
}

const chord = (key: string, m: Partial<Omit<KeyChord, 'key'>> = {}): KeyChord => ({
  key,
  meta: m.meta ?? false,
  ctrl: m.ctrl ?? false,
  alt: m.alt ?? false,
  shift: m.shift ?? false
});

describe('keybindings — Keyboard shortcuts are user-customizable', () => {
  it('Default bindings apply with no customization', () => {
    const b = defaultBindings();
    expect(b.newSession).toEqual(chord('N', { meta: true }));
    expect(b.newWorktreeSession).toEqual(chord('N', { meta: true, shift: true }));
    expect(b.toggleTerminals).toEqual(chord('J', { meta: true }));
    expect(b.showShortcuts).toEqual(chord('/', { meta: true }));
    expect(b.nextAgent).toEqual(chord('ArrowDown', { meta: true }));
    expect(b.archiveSession).toEqual(chord('W', { meta: true }));
    expect(b.insertFilePath).toEqual(chord('O', { meta: true }));
    // Every definition resolves to itself.
    for (const d of SHORTCUT_DEFS) expect(b[d.id]).toEqual(d.default);
    // resolveBindings with nothing behaves the same.
    expect(resolveBindings(undefined)).toEqual(b);
    expect(resolveBindings(null)).toEqual(b);
  });

  it('Rebinding a shortcut changes what triggers it', () => {
    const b = resolveBindings({ newSession: chord('K', { meta: true, shift: true }) });
    expect(chordMatches(b.newSession, ev('k', { metaKey: true, shiftKey: true }))).toBe(true);
    expect(chordMatches(b.newSession, ev('K', { metaKey: true, shiftKey: true }))).toBe(true);
    expect(chordMatches(b.newSession, ev('n', { metaKey: true }))).toBe(false);
    // Exact modifier match: an extra modifier is a different chord.
    expect(chordMatches(b.newSession, ev('k', { metaKey: true, shiftKey: true, altKey: true }))).toBe(
      false
    );
    // Other shortcuts keep their defaults.
    expect(chordMatches(b.createTask, ev('t', { metaKey: true }))).toBe(true);
  });

  it('A binding already used by another shortcut is refused', () => {
    const b = defaultBindings();
    // ⌘T is createTask's default → recording it for newSession conflicts.
    expect(findConflict(b, 'newSession', chord('T', { meta: true }))).toBe('createTask');
    // The lowercase form is the same chord.
    expect(findConflict(b, 'newSession', chord('t', { meta: true }))).toBe('createTask');
    // Re-recording a shortcut's OWN chord is not a conflict.
    expect(findConflict(b, 'newSession', chord('N', { meta: true }))).toBeNull();
    // A free chord is not a conflict.
    expect(findConflict(b, 'newSession', chord('K', { meta: true, shift: true }))).toBeNull();
    // ⌘⇧↓ vs ⌘↓ differ by shift, so they don't collide.
    expect(findConflict(b, 'nextProject', chord('ArrowDown', { meta: true, shift: true }))).toBeNull();
  });

  it('Resetting a shortcut restores its default', () => {
    const custom = resolveBindings({ newSession: chord('K', { meta: true }) });
    expect(custom.newSession).toEqual(chord('K', { meta: true }));
    const { newSession: _dropped, ...rest } = { newSession: chord('K', { meta: true }) };
    const reset = resolveBindings(rest);
    expect(reset.newSession).toEqual(chord('N', { meta: true }));
  });

  it('Invalid persisted bindings are ignored', () => {
    // Non-object slice → no overrides.
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides('x')).toEqual({});
    expect(parseOverrides([1])).toEqual({});
    // Unknown id, missing key, wrong types, and a non-recordable chord are dropped;
    // a valid one is kept (with the key normalized).
    const o = parseOverrides({
      bogus: chord('K', { meta: true }),
      newSession: { meta: true },
      createTask: { key: 5, meta: true },
      toggleTerminals: { key: 'x' }, // no modifier → not recordable
      newTerminal: { key: 'k', meta: true, shift: 'yes' }
    });
    expect(o).toEqual({ newTerminal: chord('K', { meta: true }) });
    // Resolving falls back to the defaults for everything dropped.
    const b = resolveBindings(o);
    expect(b.newSession).toEqual(chord('N', { meta: true }));
    expect(b.createTask).toEqual(chord('T', { meta: true }));
    expect(b.toggleTerminals).toEqual(chord('J', { meta: true }));
    expect(b.newTerminal).toEqual(chord('K', { meta: true }));
    expect(parseChord({ key: 'ArrowUp', meta: true })).toEqual(chord('ArrowUp', { meta: true }));
  });

  it('A chord without a modifier is not recordable', () => {
    expect(isRecordableChord(chord('a'))).toBe(false);
    expect(isRecordableChord(chord('A', { shift: true }))).toBe(false);
    expect(isRecordableChord(chord('a', { meta: true }))).toBe(true);
    expect(isRecordableChord(chord('a', { ctrl: true }))).toBe(true);
    expect(isRecordableChord(chord('a', { alt: true }))).toBe(true);
    // Function keys stand alone.
    expect(isRecordableChord(chord('F5'))).toBe(true);
    // A modifier key alone is never a chord.
    expect(isRecordableChord(chord('Meta', { meta: true }))).toBe(false);
    expect(chordFromEvent(ev('Meta', { metaKey: true }))).toBeNull();
    expect(chordFromEvent(ev('Shift', { shiftKey: true }))).toBeNull();
    expect(chordFromEvent(ev('n', { metaKey: true }))).toEqual(chord('N', { meta: true }));
  });

  it('Shortcut hints follow the custom binding', () => {
    expect(formatChord(chord('K', { meta: true, shift: true }))).toEqual(['⌘', '⇧', 'K']);
    expect(formatChordText(chord('K', { meta: true, shift: true }))).toBe('⌘⇧K');
    expect(formatChordText(chord('ArrowDown', { meta: true }))).toBe('⌘↓');
    expect(formatChordText(chord('Tab', { meta: true }))).toBe('⌘Tab');
    expect(formatChordText(chord('/', { meta: true }))).toBe('⌘/');
    expect(formatChordText(chord('F5'))).toBe('F5');
    expect(formatChordText(chord('x', { ctrl: true, alt: true }))).toBe('⌃⌥X');
    // The hint for a rebound shortcut is the rebound chord.
    const b = resolveBindings({ newSession: chord('K', { meta: true, shift: true }) });
    expect(formatChordText(b.newSession)).toBe('⌘⇧K');
  });
});
