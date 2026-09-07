import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Tauri bridge BEFORE importing the module under test (persist.ts
// invokes `settings_load` / `settings_save`).
const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a)
}));

import { ShortcutsStore, parseShortcutPrefs } from './shortcuts.svelte';
import type { KeyChord } from '$lib/ui/keybindings';

const chord = (key: string, m: Partial<Omit<KeyChord, 'key'>> = {}): KeyChord => ({
  key,
  meta: m.meta ?? false,
  ctrl: m.ctrl ?? false,
  alt: m.alt ?? false,
  shift: m.shift ?? false
});

const flush = () => new Promise((r) => setTimeout(r, 0));

/** The `shortcuts` slice from the most recent `settings_save` call. */
function savedSlice(): unknown {
  const calls = invokeMock.mock.calls.filter((c) => c[0] === 'settings_save');
  const last = calls[calls.length - 1];
  if (!last) return undefined;
  const json = (last[1] as { json: string }).json;
  return (JSON.parse(json) as Record<string, unknown>).shortcuts;
}

describe('parseShortcutPrefs', () => {
  it('Invalid persisted bindings are ignored', () => {
    expect(parseShortcutPrefs(undefined)).toEqual({ overrides: {} });
    expect(parseShortcutPrefs('nope')).toEqual({ overrides: {} });
    expect(parseShortcutPrefs({ overrides: 'nope' })).toEqual({ overrides: {} });
    expect(
      parseShortcutPrefs({
        overrides: { newSession: { key: 'k', meta: true }, bogus: { key: 'x', meta: true } }
      })
    ).toEqual({ overrides: { newSession: chord('K', { meta: true }) } });
  });
});

describe('ShortcutsStore', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => null);
  });

  it('Default bindings apply with no customization', async () => {
    const s = new ShortcutsStore();
    await s.load();
    expect(s.loaded).toBe(true);
    expect(s.text('newSession')).toBe('⌘N');
    expect(s.matches({ key: 'n', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, 'newSession')).toBe(true);
    expect(s.isCustomized('newSession')).toBe(false);
  });

  it('Custom bindings persist in the settings slice', async () => {
    const s = new ShortcutsStore();
    await s.load();
    const res = s.setBinding('newSession', chord('K', { meta: true, shift: true }));
    expect(res).toEqual({ ok: true });
    await flush();
    expect(savedSlice()).toEqual({
      overrides: { newSession: chord('K', { meta: true, shift: true }) }
    });
    // A fresh store reading that slice back applies it.
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({ shortcuts: { overrides: { newSession: chord('K', { meta: true, shift: true }) } } })
    );
    const again = new ShortcutsStore();
    await again.load();
    expect(again.text('newSession')).toBe('⌘⇧K');
    expect(again.isCustomized('newSession')).toBe(true);
    expect(again.matches({ key: 'K', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }, 'newSession')).toBe(true);
    expect(again.matches({ key: 'n', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, 'newSession')).toBe(false);
  });

  it('A binding already used by another shortcut is refused', async () => {
    const s = new ShortcutsStore();
    await s.load();
    const res = s.setBinding('newSession', chord('T', { meta: true }));
    expect(res).toEqual({ ok: false, conflict: 'createTask' });
    expect(s.text('newSession')).toBe('⌘N');
    await flush();
    expect(savedSlice()).toBeUndefined();
  });

  it('Resetting a shortcut restores its default', async () => {
    const s = new ShortcutsStore();
    await s.load();
    s.setBinding('newSession', chord('K', { meta: true }));
    expect(s.text('newSession')).toBe('⌘K');
    s.resetBinding('newSession');
    expect(s.text('newSession')).toBe('⌘N');
    expect(s.isCustomized('newSession')).toBe(false);
    await flush();
    expect(savedSlice()).toEqual({ overrides: {} });
    // Recording the default itself stores no override.
    s.setBinding('createTask', chord('t', { meta: true }));
    expect(s.prefs.overrides.createTask).toBeUndefined();
    // Reset all clears every override.
    s.setBinding('newSession', chord('K', { meta: true }));
    s.setBinding('newTerminal', chord('U', { meta: true }));
    s.resetAll();
    expect(s.prefs.overrides).toEqual({});
  });
});

describe('ShortcutsStore — hardening', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => null);
  });

  it('Resetting a shortcut is refused when its default is taken', async () => {
    const s = new ShortcutsStore();
    await s.load();
    expect(s.setBinding('newSession', chord('K', { meta: true }))).toEqual({ ok: true });
    // ⌘N is free now, so another shortcut may take it…
    expect(s.setBinding('archiveSession', chord('N', { meta: true }))).toEqual({ ok: true });
    // …and resetting newSession back to ⌘N must be refused (never two on one chord).
    expect(s.resetBinding('newSession')).toEqual({ ok: false, conflict: 'archiveSession' });
    expect(s.text('newSession')).toBe('⌘K');
    expect(s.text('archiveSession')).toBe('⌘N');
    // Freeing ⌘N makes the reset succeed.
    expect(s.resetBinding('archiveSession')).toEqual({ ok: true });
    expect(s.resetBinding('newSession')).toEqual({ ok: true });
    expect(s.text('newSession')).toBe('⌘N');
  });

  it('System chords are reserved', async () => {
    const s = new ShortcutsStore();
    await s.load();
    expect(s.setBinding('newSession', chord('C', { meta: true }))).toEqual({ ok: false, reserved: true });
    expect(s.text('newSession')).toBe('⌘N');
    await flush();
    expect(savedSlice()).toBeUndefined();
  });
});
