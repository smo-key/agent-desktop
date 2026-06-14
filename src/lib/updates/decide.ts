// PURE update-decision seam (desktop-auto-update spec, "In-app update check on
// launch"). The live Tauri updater/process APIs are runtime-bound and not
// headless-testable, so the BRANCHING logic is factored here behind small,
// data-only types and unit-tested in `decide.test.ts`. `checkForUpdate.ts`
// supplies the real `check()` / `ask()` / install effects and feeds their
// results through `decideUpdateAction`.

/** The minimal shape we care about from the updater's `check()` result. */
export interface UpdateInfo {
  /** The available version (for the confirm prompt copy). */
  version: string;
}

/**
 * The lifecycle of a background-staged update, as tracked by `updateStore`:
 * `idle` (nothing known) → `downloading` (fetching the bundle) → `ready` (staged,
 * the "Restart to update" pill shows). Defined here, in the pure seam, so the
 * download decision below can reason about it without importing the rune store.
 */
export type UpdateStatus = 'idle' | 'downloading' | 'ready';

/** What a (recurring or post-decline) check result should trigger, decided purely.
 *  Generic over the update shape so callers passing the live `Update` handle get
 *  it back (with its `download()`/`install()` methods), not a widened `UpdateInfo`. */
export type CheckAction<T extends UpdateInfo = UpdateInfo> =
  | { kind: 'ignore' } // no update, or we already have this version in flight/staged
  | { kind: 'download'; update: T }; // start a background download

/** What the launch flow should do next, decided purely from inputs. */
export type UpdateAction =
  | { kind: 'none' } // no update available, or the check failed → no-op
  | { kind: 'declined'; update: UpdateInfo } // user said no → no-op
  | { kind: 'install'; update: UpdateInfo }; // user confirmed → download+install+relaunch

/**
 * Decide the launch update action PURELY from the check result and the user's
 * confirmation.
 *
 * - `update == null` (no newer version, OR the check threw and the caller mapped
 *   the failure to `null`) → `none`: continue silently, never surface an error.
 * - update present, `confirmed === false` → `declined`: continue without
 *   installing.
 * - update present, `confirmed === true` → `install`: download, verify, install,
 *   then relaunch.
 */
export function decideUpdateAction(
  update: UpdateInfo | null,
  confirmed: boolean
): UpdateAction {
  if (!update) return { kind: 'none' };
  return confirmed
    ? { kind: 'install', update }
    : { kind: 'declined', update };
}

/**
 * Decide, PURELY, whether a check result should kick off a background download.
 * Used by both the launch "Later" path and the recurring hourly poll, so the
 * "should we download this?" logic stays out of the IPC-bound code.
 *
 * - `update == null` (no newer version, or a swallowed check failure) → `ignore`.
 * - we are already `downloading`/`ready` for THIS SAME version → `ignore` (no
 *   duplicate download, no duplicate pill).
 * - otherwise (idle, or a genuinely newer version that supersedes an older
 *   in-flight/staged one) → `download`.
 */
export function decideCheckAction<T extends UpdateInfo>(
  update: T | null,
  current: { status: UpdateStatus; version: string | null }
): CheckAction<T> {
  if (!update) return { kind: 'ignore' };
  const alreadyHandled =
    (current.status === 'downloading' || current.status === 'ready') &&
    current.version === update.version;
  return alreadyHandled ? { kind: 'ignore' } : { kind: 'download', update };
}
