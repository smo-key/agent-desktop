// Needs-input-alerts preferences: the two alert-channel modes (sound + desktop),
// stored as the `notifications` slice of the shared `settings.json` blob. Like the
// other settings stores (see `autoAdvance.svelte.ts`), it loads once on startup and
// saves (best-effort, merge-aware) on every change so it never clobbers sibling
// slices. The pure `parseNotificationPrefs` validator is unit-tested. Each channel
// DEFAULTS TO `off` — out of the box the app is silent (the feature is opt-in); a
// channel's mode IS its enable switch.

import { loadSettings, saveSettingsSlice } from './persist';
import type { AlertMode, NotificationPrefs } from '$lib/overview/notify';

export type { AlertMode, NotificationPrefs };

/** The valid channel modes, used to validate a persisted value. */
const ALERT_MODES: readonly AlertMode[] = ['off', 'app-unfocused', 'agent-unfocused', 'always'];

/** Defaults for a fresh install: both channels OFF (silent, opt-in). */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  sound: { mode: 'off' },
  desktop: { mode: 'off' }
};

/** PURE: validate one persisted channel value into a recognized `AlertMode`,
 *  falling back to `off` for any non-object / missing / unknown mode. */
function parseChannel(raw: unknown): { mode: AlertMode } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { mode: 'off' };
  const mode = (raw as Record<string, unknown>).mode;
  return { mode: ALERT_MODES.includes(mode as AlertMode) ? (mode as AlertMode) : 'off' };
}

/** PURE: validate/normalize the persisted `notifications` slice into a fully-
 *  defaulted `NotificationPrefs`. Tolerates any shape — non-objects, missing
 *  channels, and unknown modes fall back to `off` per channel. */
export function parseNotificationPrefs(raw: unknown): NotificationPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { sound: { mode: 'off' }, desktop: { mode: 'off' } };
  }
  const obj = raw as Record<string, unknown>;
  return {
    sound: parseChannel(obj.sound),
    desktop: parseChannel(obj.desktop)
  };
}

/**
 * Reactive notification settings store. Singleton, imported by the settings modal
 * (read/write) and the inbox alert shell (read).
 */
export class NotificationStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<NotificationPrefs>({
    sound: { mode: 'off' },
    desktop: { mode: 'off' }
  });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** Load persisted prefs from the shared settings blob's `notifications` slice.
   *  On a fresh install the `DEFAULT_NOTIFICATION_PREFS` apply (both OFF). Never
   *  throws. Call once on mount. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    this.prefs = parseNotificationPrefs(settings.notifications);
    this.loaded = true;
  }

  /** Set the sound channel's mode and persist (best-effort). */
  setSoundMode(mode: AlertMode): void {
    this.prefs = { ...this.prefs, sound: { mode } };
    void this.save();
  }

  /** Set the desktop channel's mode and persist (best-effort). */
  setDesktopMode(mode: AlertMode): void {
    this.prefs = { ...this.prefs, desktop: { mode } };
    void this.save();
  }

  /** Persist the current prefs as the `notifications` slice, merging into the
   *  shared settings blob so sibling slices (e.g. voice, autoAdvance) are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('notifications', this.prefs);
  }
}

/** The singleton notification store. */
export const notifications = new NotificationStore();
