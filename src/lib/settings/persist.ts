// Shared settings persistence. `settings.json` is a single opaque JSON blob on
// the Rust side (`settings_load` / `settings_save`), so every settings area —
// open-with, voice, … — must coexist as a keyed *slice* of one object. Writing a
// slice with a naive `JSON.stringify({ slice })` would clobber the others, so all
// stores save through `saveSettingsSlice`, which does a read-modify-write merge.
//
// Plain `.ts` (no runes): these are pure async helpers, not reactive state.

import { invoke } from '@tauri-apps/api/core';

/** A parsed settings object: a flat map of slice key → arbitrary slice value. */
export type Settings = Record<string, unknown>;

/**
 * Load the full settings object from `settings.json`. Returns `{}` on a fresh
 * install (no file → null), a corrupt/non-JSON blob, a JSON value that is not a
 * plain object (array/scalar), or any invoke failure (e.g. non-Tauri env). Never
 * throws.
 */
export async function loadSettings(): Promise<Settings> {
  let raw: string | null = null;
  try {
    raw = await invoke<string | null>('settings_load');
  } catch (err) {
    console.error('settings_load failed', err);
    return {};
  }
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return obj as Settings;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Persist a single settings slice under `key`, merging into the current
 * `settings.json` so sibling slices are preserved. Read-modify-write:
 * load current → set `obj[key] = value` → save the whole object. Best-effort:
 * a save failure is logged, not thrown.
 */
export async function saveSettingsSlice(key: string, value: unknown): Promise<void> {
  const obj = await loadSettings();
  obj[key] = value;
  try {
    await invoke('settings_save', { json: JSON.stringify(obj) });
  } catch (err) {
    console.error('settings_save failed', err);
  }
}
