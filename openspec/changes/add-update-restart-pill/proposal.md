## Why

Today an available update is only surfaced once, by a blocking dialog at launch;
decline it and the update is forgotten until the next restart, and a release
published while the app is running is never noticed at all. Users need a calm,
always-visible way to pick up an update on their own schedule.

## What Changes

- Add a recurring (~hourly) background update check for the lifetime of the
  session, in addition to the existing launch check. Recurring checks never show
  a modal.
- When a newer version is found (by the hourly check, or by declining the launch
  prompt), download and **stage** it in the background using the updater plugin's
  separate `download()` step — no install yet.
- Add an orange **"Restart to update"** pill (with a gift icon) to the title bar,
  as the leftmost item of the right-hand controls. It appears only once an update
  is staged; activating it installs the staged update and relaunches.
- Keep the existing on-launch confirm dialog unchanged (confirm → install + relaunch
  immediately; "Later" → hand off to the background-download + pill path).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `desktop-auto-update`: ADD a background-staging requirement (hourly re-check +
  decline-to-background) and a restart-pill requirement. The existing
  launch-prompt behavior is unchanged, so these are additive requirements on the
  same capability (its base spec currently lives in the unarchived
  `add-desktop-release-ci` change, so we add — not modify — its requirements).

## Impact

- Frontend: new `src/lib/updates/updateStore.svelte.ts`; extends
  `src/lib/updates/checkForUpdate.ts` (hourly polling + background download) and
  `src/lib/updates/decide.ts` (pure decision for what a check result should do).
- UI: `src/routes/+page.svelte` title bar (`.tb-right`) gains the pill;
  `src/lib/icons/projectIcons.ts` gains a `gift` glyph.
- Dependencies: no new deps — uses the already-present `@tauri-apps/plugin-updater`
  (`download()` / `install()`) and `@tauri-apps/plugin-process` (`relaunch()`).
- No backend/Rust changes; updater + process plugins are already registered.
