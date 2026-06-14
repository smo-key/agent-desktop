// In-app update orchestration (desktop-auto-update spec). On launch, and then on a
// recurring hourly poll, we ask the Tauri updater whether a newer version is
// published; if so we download + STAGE it in the background — with no dialog — and
// the title-bar pill surfaces progress / "Restart to update". When there is no
// update, the check fails (offline), or we're not under the Tauri runtime (e.g.
// `vite dev` in a browser, or tests), we continue SILENTLY: never blocking startup,
// never surfacing a header error. (A found update whose DOWNLOAD then fails is the
// one actionable case — updateStore surfaces a retryable "failed" pill.)
//
// All runtime-bound effects live here; the branching decision is the PURE
// `decideCheckAction` (see decide.ts), unit-tested headlessly. `runUpdateCheck` is
// the single check→stage cycle shared by launch, the poll, the retry pill (via the
// store's injected `recheck`), and the manual Settings check (which reads its
// returned outcome).

import { check } from '@tauri-apps/plugin-updater';
import { decideCheckAction } from './decide';
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

/** The outcome of one `runUpdateCheck`, consumed by the manual Settings check. */
export type CheckOutcome =
  | 'started' // a newer version was found and a background download was kicked off
  | 'up-to-date' // no newer version available
  | 'noop' // a newer version was found but is already downloading/staged
  | 'error' // the check itself failed (offline / IPC) — no update found
  | 'unavailable'; // not running under the Tauri runtime

/**
 * Run a single check→stage cycle. Best-effort and non-blocking: if an update is
 * found it is handed to `updateStore.beginDownload` (fire-and-forget — progress is
 * observed reactively via the store) and we return immediately. Any check failure
 * is swallowed and reported as `'error'` so the background callers stay silent
 * while the manual Settings check can surface it.
 */
export async function runUpdateCheck(): Promise<CheckOutcome> {
  if (!inTauri()) return 'unavailable';
  try {
    const update = await check();
    if (!update) return 'up-to-date';
    const action = decideCheckAction(update, updateStore.snapshot);
    if (action.kind === 'download') {
      void updateStore.beginDownload(action.update);
      return 'started';
    }
    // Already downloading/staged this version (launch-vs-poll race, or an hourly
    // re-check of a staged version): drop the redundant handle so its backend
    // resource isn't leaked, and start no second download.
    await closeUpdate(update);
    return 'noop';
  } catch (err) {
    // Offline / IPC error / no manifest. Continue silently in the background;
    // `'error'` lets the manual Settings check surface "Couldn't check — retry".
    console.warn('update check skipped:', err);
    return 'error';
  }
}

/**
 * Check for an update on launch and, if one is available, download + stage it in
 * the background (no prompt). Best-effort and non-blocking: ANY failure (no update,
 * offline, IPC error, non-Tauri context) is swallowed and the app continues
 * normally with nothing surfaced. Also wires the store's `retry()` seam.
 *
 * Returns a promise that resolves once the check settles; callers `void` it from
 * `onMount` so startup is never blocked.
 */
export async function checkForUpdateOnLaunch(): Promise<void> {
  updateStore.recheck = runUpdateCheck;
  await runUpdateCheck();
}

/**
 * Start the recurring background update check. In addition to the launch check
 * above, re-check every `intervalMs` (default: hourly) for the lifetime of the
 * session. Never shows a dialog — a newer version is downloaded + staged in the
 * background and surfaced only via the title-bar pill. Best-effort: any failure is
 * swallowed and retried on the next tick. Outside the Tauri runtime it's a no-op.
 *
 * Returns a stop function (clears the interval) for the caller's teardown.
 */
export function startUpdatePolling(intervalMs: number = POLL_INTERVAL_MS): () => void {
  if (!inTauri()) return () => {};
  updateStore.recheck = runUpdateCheck;
  const id = setInterval(() => void runUpdateCheck(), intervalMs);
  return () => clearInterval(id);
}
