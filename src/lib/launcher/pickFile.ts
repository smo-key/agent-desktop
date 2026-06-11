// Native FILE picker for the "Insert Filename" terminal action (terminal
// insert-filename spec). Thin async wrapper over the Tauri dialog plugin's
// `open({ directory: false, multiple: false })`, isolated here so the rest of
// the feature depends on a tiny, mockable surface rather than the plugin
// directly — and mirrored exactly on `src/lib/launcher/pick.ts`.
//
// The dialog plugin is registered on the Rust side (lib.rs) and granted
// `dialog:allow-open` in src-tauri/capabilities/default.json. The native dialog
// itself is a MANUAL verification (no headless GUI); cancellation -> null is the
// contract every caller must honor (cancel inserts nothing — the terminal is
// left untouched).

import { open } from '@tauri-apps/plugin-dialog';

/**
 * Open the native file-selection dialog and resolve to the ABSOLUTE path of the
 * chosen file, or `null` if the user cancels (or the dialog is unavailable, e.g.
 * outside Tauri). `directory: false` + `multiple: false` means the plugin
 * returns `string | null`; a defensive guard collapses the
 * (impossible-for-our-options) array form to its first element so the return is
 * always `string | null`.
 *
 * @param defaultPath optional starting directory for the dialog.
 */
export async function pickFile(
  defaultPath?: string
): Promise<string | null> {
  try {
    const selected = await open({
      directory: false,
      multiple: false,
      defaultPath
    });
    if (selected == null) return null;
    // With { directory:false, multiple:false } the plugin returns a single path,
    // but guard the array shape defensively so we always hand back string|null.
    if (Array.isArray(selected)) return selected[0] ?? null;
    return selected;
  } catch (err) {
    // No dialog available (non-Tauri preview) or the user closed it abnormally:
    // treat as a cancel so nothing is inserted, never a crash.
    console.error('pickFile failed', err);
    return null;
  }
}
