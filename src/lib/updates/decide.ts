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
