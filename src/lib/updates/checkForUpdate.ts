// Launch-time in-app update check (desktop-auto-update spec, "In-app update check
// on launch"). On startup we ask the Tauri updater whether a newer version is
// published; if so we prompt the user and, on confirmation, download/verify/
// install it and relaunch. When there is no update, the check fails (offline), or
// we're not running under the Tauri runtime (e.g. `vite dev` in a browser, or
// tests), we continue SILENTLY — never blocking startup, never surfacing an error.
//
// All the runtime-bound effects live here; the branching decision is the PURE
// `decideUpdateAction` (see decide.ts), which is unit-tested headlessly.

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ask } from '@tauri-apps/plugin-dialog';
import { decideCheckAction, decideUpdateAction } from './decide';
import { updateStore } from './updateStore.svelte';
import { closeUpdate } from './resource';

/** Recurring background-check cadence: once per hour (spec: hourly re-check). */
const POLL_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Whether we're running inside the Tauri runtime. Outside it (browser `vite dev`,
 * unit tests) the updater/process IPC is absent, so the whole flow is a no-op
 * rather than a thrown error. Tauri injects `__TAURI_INTERNALS__` on the window.
 */
function inTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'
  );
}

/**
 * Check for an update on launch and, if one is available and the user confirms,
 * install it and relaunch. Best-effort and non-blocking: ANY failure (no update,
 * offline, IPC error, non-Tauri context) is swallowed and the app continues
 * normally with nothing surfaced to the user.
 *
 * Returns a promise that resolves once the flow settles; callers `void` it from
 * `onMount` so startup is never blocked.
 */
export async function checkForUpdateOnLaunch(): Promise<void> {
  // Bail immediately outside the Tauri runtime — `check()` would throw.
  if (!inTauri()) return;

  try {
    const update = await check();

    // No update available: the pure decision is a no-op; bail before any prompt.
    if (!update) return;

    // Already downloading/staged this version (e.g. a re-entrant launch): the
    // "Restart to update" pill is the surface — don't also prompt. Close the
    // freshly-obtained handle so its backend resource isn't leaked.
    if (decideCheckAction(update, updateStore.snapshot).kind === 'ignore') {
      await closeUpdate(update);
      return;
    }

    const confirmed = await ask(
      `Agent Desktop ${update.version} is available. Install it now? The app will restart.`,
      { title: 'Update available', kind: 'info', okLabel: 'Install', cancelLabel: 'Later' }
    );

    const action = decideUpdateAction({ version: update.version }, confirmed);
    if (action.kind === 'install') {
      await update.downloadAndInstall();
      await relaunch();
      return;
    }

    // Declined ("Later"): download + stage in the background so the "Restart to
    // update" pill appears. The user applies it whenever they like — we never
    // discard a known update for the session. Not awaited: the launch flow
    // returns immediately while the (large) bundle downloads in the background.
    void updateStore.beginDownload(update);
  } catch (err) {
    // Offline / IPC error / no manifest / etc. Continue silently — never block
    // startup, never surface an error to the user (spec: "No update or check fails").
    console.warn('update check skipped:', err);
  }
}

/**
 * Start the recurring background update check. In addition to the launch check
 * above, re-check every `intervalMs` (default: hourly) for the lifetime of the
 * session. Unlike launch, this NEVER shows a dialog — a newer version is
 * downloaded + staged in the background and surfaced only via the "Restart to
 * update" pill. Best-effort: any check/download failure is swallowed and retried
 * on the next tick. Outside the Tauri runtime it's a no-op.
 *
 * Returns a stop function (clears the interval) for the caller's teardown.
 */
export function startUpdatePolling(intervalMs: number = POLL_INTERVAL_MS): () => void {
  if (!inTauri()) return () => {};

  const tick = async (): Promise<void> => {
    try {
      const update = await check();
      const action = decideCheckAction(update, updateStore.snapshot);
      if (action.kind === 'download') {
        // beginDownload owns the handle from here (stages it, or closes it if a
        // concurrent download supersedes/duplicates it).
        await updateStore.beginDownload(action.update);
      } else if (update) {
        // No-op for this version (already staged/downloading): release the
        // freshly-obtained handle so the hourly re-check doesn't leak a resource.
        await closeUpdate(update);
      }
    } catch (err) {
      console.warn('update poll skipped:', err);
    }
  };

  const id = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(id);
}
