// PURE update-decision seam (desktop-auto-update spec). The live Tauri updater/
// process APIs are runtime-bound and not headless-testable, so the BRANCHING logic
// is factored here behind small, data-only types and unit-tested in
// `decide.test.ts`. `checkForUpdate.ts` supplies the real `check()` effect and
// feeds its result through `decideCheckAction` to decide whether to background-
// download.

/** The minimal shape we care about from the updater's `check()` result. */
export interface UpdateInfo {
  /** The available version (pill copy + dedupe key). */
  version: string;
}

/**
 * The lifecycle of a background-staged update, as tracked by `updateStore`:
 * `idle` (nothing known) → `downloading` (fetching the bundle) → `ready` (staged,
 * the "Restart to update" pill shows) → `installing` (the user clicked restart;
 * applying + relaunching). `failed` is a side-branch: a download that was found
 * then errored — the pill shows a retryable "Update failed" affordance (distinct
 * from a silent check failure). Defined here, in the pure seam, so the download
 * decision below can reason about it without importing the rune store.
 */
export type UpdateStatus = 'idle' | 'downloading' | 'ready' | 'installing' | 'failed';

/** What a (recurring or post-decline) check result should trigger, decided purely.
 *  Generic over the update shape so callers passing the live `Update` handle get
 *  it back (with its `download()`/`install()` methods), not a widened `UpdateInfo`. */
export type CheckAction<T extends UpdateInfo = UpdateInfo> =
  | { kind: 'ignore' } // no update, or we already have this version in flight/staged
  | { kind: 'download'; update: T }; // start a background download

/**
 * Decide, PURELY, whether a check result should kick off a background download.
 * Used by the launch check, the recurring hourly poll, and the manual Settings
 * check, so the "should we download this?" logic stays out of the IPC-bound code.
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
