## 1. Store: progress, failure, retry (TDD)

- [ ] 1.1 Write failing tests in `src/lib/updates/updateStore.svelte.test.ts` for: `Started{contentLength}` sets `totalBytes` and `Progress{chunkLength}` accumulates `downloadedBytes` with a derived `percent`; an indeterminate download (no `contentLength`) leaves `percent` null while `status === 'downloading'`.
- [ ] 1.2 Write failing tests for the `failed` state: a download/stage error sets `status === 'failed'` with `lastError`; `retry()` re-runs check+download; a later success clears `failed`; the `seq`-token concurrency guard still supersedes/closes stale handles under the new fields.
- [ ] 1.3 Extend `updateStore.svelte.ts`: add `UpdateStatus` `'failed'`; add reactive `downloadedBytes` / `totalBytes` / `percent` / `lastError`; thread a progress callback into `update.download(onEvent)` inside `beginDownload`; set `failed` on download/stage error; add `retry()`. Keep the `seq` guard intact. Get section 1 tests green.

## 2. Launch + poll: remove the dialog (TDD)

- [ ] 2.1 Update `src/lib/updates/checkForUpdate.test.ts`: replace the dialog-path expectations — launch with an available update now calls `beginDownload` (no `ask`); a launch/poll check failure stays silent (no `failed`); a download failure routes to the store `failed` state. Remove assertions tied to the old confirm prompt.
- [ ] 2.2 Edit `checkForUpdate.ts`: delete the `ask()` call and the dialog import; on a found update call `updateStore.beginDownload(update)` directly so launch and hourly poll share one staging path. Preserve the `decideCheckAction` ignore/close behavior and the offline-silent `catch`. Get section 2 tests green.
- [ ] 2.3 Remove the dead `decideUpdateAction` from `src/lib/updates/decide.ts` and its tests in `decide.test.ts`; confirm `decideCheckAction` and its tests remain.

## 3. Title-bar pill: morph in place

- [ ] 3.1 In `src/routes/+page.svelte`, change the pill render condition from `status === 'ready'` to render for `downloading | ready | failed | installing` (hidden for `idle`).
- [ ] 3.2 Implement the per-state content: `⟳ Updating… N%` (or indeterminate `⟳ Updating…` when `percent` is null), `🎁 Restart to update`, `⟳ Restarting…` (installing), `⚠ Update failed · retry`. Only `ready` (→ `restartToUpdate()`) and `failed` (→ `retry()`) are clickable; downloading/installing are inert. Keep the existing tooltip/version text where relevant.
- [ ] 3.3 Add/adjust styles for the new states (progress/percent text, the `failed` warning treatment) consistent with the existing pill styling; ensure leftmost-of-right-controls placement is unchanged.

## 4. Settings: "Check for updates"

- [ ] 4.1 Locate the Settings view/component and add an "Updates" row showing the current app version via `getVersion()` from `@tauri-apps/api/app`.
- [ ] 4.2 Add a "Check for updates" button that runs a manual check driving the shared `updateStore`, with a manual-check signal for the user-initiated outcomes. Render inline status: `Checking…` → `Downloading… N%` → `Update ready — restart` / `You're up to date` / `Couldn't check — retry`. Surface check-level failures inline (unlike the silent background path); clicking retry re-checks.
- [ ] 4.3 Verify the manual check and the hourly poll do not double-download (shared `seq` guard) and that a manual-found update also lights the header pill.

## 5. Verify

- [ ] 5.1 Run the full frontend test suite and type-check/lint; fix any fallout from removing the dialog path and `decideUpdateAction`.
- [ ] 5.2 Reconcile drift: confirm `proposal.md`, `specs/desktop-auto-update/spec.md`, and `tasks.md` match the implemented behavior; run `openspec validate header-update-progress`.
- [ ] 5.3 Manual smoke (best-effort, dev runtime): confirm no dialog appears on launch and the pill/settings states render for downloading/ready/failed; note the one-time manual-install caveat for the shipped 0.2.1 binary.
