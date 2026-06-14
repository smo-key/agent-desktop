## Why

The on-launch update flow calls `ask()` (a confirm dialog), but the app capability
grants only `dialog:allow-open`, not `dialog:allow-ask` — so `ask()` is
permission-denied, throws, and is swallowed by the surrounding `try/catch`, which
also short-circuits the background-download fallback. The result is a **dead
updater**: no dialog and no restart pill ever appear, even though a newer version
is correctly published and verifiable. Beyond the bug, the update process is
effectively invisible — there is no progress, no failure surface, and no way to
check on demand — so users cannot tell whether updating is working.

## What Changes

- **BREAKING (UX)**: Remove the on-launch confirm dialog entirely. Both the launch
  check and the recurring hourly check now download + stage an available update in
  the background with no modal. This eliminates the `dialog:allow-ask` dependency
  that was permission-denied, so the dead-updater bug cannot recur.
- Surface **download progress in the title-bar pill**, morphing it in place through
  states: `Updating… N%` (indeterminate `Updating…` when the manifest reports no
  content length) → `Restart to update` → `Restarting…` while installing.
- Surface **download failures** as a retryable header state (`Update failed ·
  retry`); clicking it re-checks and re-downloads. Routine background **check**
  failures (offline, no manifest) stay silent in the header and retry next poll.
- Add a **"Check for updates" control in Settings**: shows the current app version
  and, on demand, drives the same updater with inline status — `Checking…` →
  `Downloading… N%` → `Update ready — restart` / `You're up to date` / `Couldn't
  check — retry`. This is where check-level failures become visible.
- Remove the now-dead confirm-decision helper (`decideUpdateAction`) and the
  dialog import from the update code. Keep the dialog plugin and `dialog:allow-open`
  (still used by file pickers elsewhere).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `desktop-auto-update`: MODIFY the "In-app update check on launch" requirement
  (no prompt — launch now stages in the background like the hourly check); MODIFY
  the "Background staging of available updates" requirement (drop the
  declined-prompt path; launch + hourly both stage directly); MODIFY the
  "Update-ready restart pill" requirement (the pill now morphs through
  downloading / ready / installing / failed states). ADD a download-progress
  requirement, a retryable-download-failure requirement, and a manual
  "Check for updates" (Settings) requirement. Its base spec still lives in the
  unarchived `add-desktop-release-ci` and `add-update-restart-pill` changes, so
  this delta must archive after those.

## Impact

- **Frontend**:
  - `src/lib/updates/checkForUpdate.ts` — launch check drops `ask()` and stages in
    the background; launch + poll share one code path.
  - `src/lib/updates/updateStore.svelte.ts` — add reactive download progress
    (`downloadedBytes` / `totalBytes` / `percent`), a `failed` state with the last
    error, and `retry()`; preserve the existing `seq`-token concurrency safety.
  - `src/lib/updates/decide.ts` — remove the dead `decideUpdateAction`; keep
    `decideCheckAction`.
  - `src/routes/+page.svelte` — the pill renders for `downloading | ready | failed |
    installing` and morphs in place.
  - Settings UI — new "Check for updates" row (current version + button + inline
    status).
- **Tests**: update/remove the dialog-path tests in `checkForUpdate.test.ts`;
  extend `updateStore.svelte.test.ts` (progress accumulation, indeterminate
  fallback, `failed`→`retry`, concurrency); drop `decideUpdateAction` tests in
  `decide.test.ts`.
- **Permissions**: no capability change required (we stop needing `dialog:allow-ask`
  rather than granting it).
- **Out of scope / caveat**: the already-installed `0.2.1` binary has the broken
  dialog path baked in and cannot self-heal; users must manually install a later
  build once. This is documentation only — no code addresses it.
