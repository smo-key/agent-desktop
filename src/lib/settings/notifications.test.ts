import { describe, expect, it, vi } from 'vitest';

// Tests for the needs-input-alerts settings store. The PURE `parseNotificationPrefs`
// validator is the focus (both channels default OFF, tolerant of any persisted
// shape). The store's save path is asserted to merge via `saveSettingsSlice` so it
// never clobbers sibling settings slices. The persist helpers are mocked.

const saveSliceMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
const loadSettingsMock = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({}));
vi.mock('./persist', () => ({
  saveSettingsSlice: (...a: unknown[]) => saveSliceMock(...a),
  loadSettings: (...a: unknown[]) => loadSettingsMock(...a)
}));

import {
  parseNotificationPrefs,
  clampDesktopMode,
  DESKTOP_ALERT_MODES,
  NotificationStore,
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs
} from './notifications.svelte';

describe('Persisted channel modes with opt-in defaults', () => {
  it('Fresh install defaults', () => {
    expect(DEFAULT_NOTIFICATION_PREFS).toEqual({ sound: { mode: 'off' }, desktop: { mode: 'off' } });
    expect(parseNotificationPrefs(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(parseNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it('Persisted modes load', () => {
    expect(
      parseNotificationPrefs({ sound: { mode: 'always' }, desktop: { mode: 'app-unfocused' } })
    ).toEqual({ sound: { mode: 'always' }, desktop: { mode: 'app-unfocused' } });
  });

  it('Malformed slice', () => {
    // Non-object, missing channel, missing mode, and unknown mode all fall back to off.
    expect(parseNotificationPrefs('nope')).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(parseNotificationPrefs(42)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(parseNotificationPrefs([])).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(parseNotificationPrefs({})).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(parseNotificationPrefs({ sound: {}, desktop: {} })).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(parseNotificationPrefs({ sound: { mode: 'loud' }, desktop: { mode: 7 } })).toEqual(
      DEFAULT_NOTIFICATION_PREFS
    );
    expect(parseNotificationPrefs({ sound: 'x', desktop: null })).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it('Saving preserves siblings', () => {
    saveSliceMock.mockClear();
    const store = new NotificationStore();
    store.setSoundMode('always');
    for (const call of saveSliceMock.mock.calls) {
      expect(call[0]).toBe('notifications');
    }
    const saved = saveSliceMock.mock.calls.at(-1)![1] as NotificationPrefs;
    expect(saved).toEqual(store.prefs);
  });
});

describe('clampDesktopMode — desktop offers only off / app-unfocused', () => {
  // Scenario: Desktop picker omits the focus-aware modes — the desktop channel's
  // canonical option set is exactly off / app-unfocused (what SettingsModal renders).
  it('Desktop picker omits the focus-aware modes', () => {
    expect([...DESKTOP_ALERT_MODES]).toEqual(['off', 'app-unfocused']);
    expect(DESKTOP_ALERT_MODES).not.toContain('agent-unfocused');
    expect(DESKTOP_ALERT_MODES).not.toContain('always');
  });

  it('keeps the two desktop-valid modes', () => {
    expect(clampDesktopMode('off')).toBe('off');
    expect(clampDesktopMode('app-unfocused')).toBe('app-unfocused');
  });

  it('clamps the focus-aware modes to app-unfocused (macOS suppresses focused notifications)', () => {
    // `agent-unfocused` / `always` only differ from `app-unfocused` while the app is
    // focused, where macOS shows nothing — so they collapse to app-unfocused.
    expect(clampDesktopMode('agent-unfocused')).toBe('app-unfocused');
    expect(clampDesktopMode('always')).toBe('app-unfocused');
  });
});

describe('NotificationStore', () => {
  it('defaults to OFF on a fresh / empty settings blob', async () => {
    loadSettingsMock.mockResolvedValueOnce({});
    const store = new NotificationStore();
    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.prefs).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it('Legacy desktop mode is clamped on load', async () => {
    loadSettingsMock.mockResolvedValueOnce({
      voice: { enabled: false },
      notifications: { sound: { mode: 'agent-unfocused' }, desktop: { mode: 'always' } }
    });
    const store = new NotificationStore();
    await store.load();
    expect(store.prefs).toEqual({
      sound: { mode: 'agent-unfocused' }, // sound keeps all four modes
      desktop: { mode: 'app-unfocused' } // legacy `always` clamped to a desktop-valid mode
    });
  });

  it('Change a channel mode', () => {
    saveSliceMock.mockClear();
    const store = new NotificationStore();
    store.setSoundMode('always');
    expect(store.prefs.sound.mode).toBe('always');
    expect(store.prefs.desktop.mode).toBe('off'); // untouched
    expect(saveSliceMock).toHaveBeenCalledWith('notifications', store.prefs);

    store.setDesktopMode('app-unfocused');
    expect(store.prefs.desktop.mode).toBe('app-unfocused');
    expect(store.prefs.sound.mode).toBe('always'); // still untouched
  });

  it('setDesktopMode clamps a focus-aware mode to app-unfocused', () => {
    const store = new NotificationStore();
    store.setDesktopMode('always');
    expect(store.prefs.desktop.mode).toBe('app-unfocused');
  });

  it('setSoundMode replaces prefs immutably', () => {
    const store = new NotificationStore();
    const before = store.prefs;
    store.setSoundMode('always');
    expect(store.prefs).not.toBe(before);
  });
});
