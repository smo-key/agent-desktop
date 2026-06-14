// Release a Tauri `Update` handle's backend resource. `Update extends Resource`,
// whose `rid` lives in the Rust resource table until `close()` is called (or the
// app exits). So ANY handle we obtain from `check()` but do not install —
// superseded by a newer version, failed mid-download, a duplicate from a
// launch-vs-poll race, or an hourly re-check of an already-staged version — must
// be closed or it leaks one backend resource each. Best-effort: a failed close is
// swallowed (we never block on resource cleanup).

import type { Update } from '@tauri-apps/plugin-updater';

/** Close an updater `Update` handle, swallowing any error. */
export async function closeUpdate(update: Pick<Update, 'close'>): Promise<void> {
  try {
    await update.close();
  } catch (err) {
    console.warn('update handle close failed:', err);
  }
}
