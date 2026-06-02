// Native folder picker for the session launcher (session-launcher spec,
// Requirement: Launch New Session With Folder Picker And Recents). Thin async
// wrapper over the Tauri dialog plugin's `open({ directory: true })`, isolated
// here so the rest of the launcher depends on a tiny, mockable surface rather
// than the plugin directly.
//
// The dialog plugin is registered on the Rust side (lib.rs) and granted
// `dialog:allow-open` in src-tauri/capabilities/default.json. The native dialog
// itself is a MANUAL verification (no headless GUI); cancellation -> null is the
// contract every caller must honor (cancel aborts the launch — no session is
// spawned, recents are left unchanged).

import { open } from '@tauri-apps/plugin-dialog';

/**
 * Open the native directory-selection dialog and resolve to the ABSOLUTE path of
 * the chosen folder, or `null` if the user cancels (or the dialog is
 * unavailable, e.g. outside Tauri). `directory: true` + `multiple: false` means
 * the plugin returns `string | null`; a defensive guard collapses the
 * (impossible-for-our-options) array form to its first element so the return is
 * always `string | null`.
 *
 * @param defaultPath optional starting directory for the dialog.
 */
export async function pickFolder(
  defaultPath?: string
): Promise<string | null> {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath
    });
    if (selected == null) return null;
    // With { directory:true, multiple:false } the plugin returns a single path,
    // but guard the array shape defensively so we always hand back string|null.
    if (Array.isArray(selected)) return selected[0] ?? null;
    return selected;
  } catch (err) {
    // No dialog available (non-Tauri preview) or the user closed it abnormally:
    // treat as a cancel so the launch is simply aborted, never a crash.
    console.error('pickFolder failed', err);
    return null;
  }
}
