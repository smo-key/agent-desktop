## 1. Pure decision seam (TDD)

- [ ] 1.1 In `src/lib/updates/decide.test.ts`, add failing cases for a new pure
      `decideCheckAction(update, status)`: returns `{ kind: 'ignore' }` when
      `update` is null; `{ kind: 'ignore' }` when the update's version equals the
      version already `downloading`/`ready`; `{ kind: 'download', update }` for a
      new version while `idle`.
- [ ] 1.2 Implement `decideCheckAction` in `src/lib/updates/decide.ts` (data-only
      types, no IPC) until the new tests pass; keep `decideUpdateAction` intact.

## 2. Update store

- [ ] 2.1 Add `src/lib/updates/updateStore.svelte.ts`: a rune store holding
      `status: 'idle' | 'downloading' | 'ready'`, `version: string | null`, and a
      private handle to the staged `Update`. Expose `restartToUpdate()` →
      `update.install()` then `relaunch()`, and a `beginDownload(update)` helper
      that sets `downloading`, awaits `update.download()`, sets `ready` (+ stashes
      the handle), and on any throw resets to `idle`.
- [ ] 2.2 Unit-test the headless-safe transitions (status/version setters and the
      `decideCheckAction`-driven dedupe) where they don't require the Tauri IPC;
      leave `install()`/`relaunch()`/`download()` as the MANUAL-verified seam.

## 3. Check orchestration

- [ ] 3.1 Extend `src/lib/updates/checkForUpdate.ts`: on the launch check, keep the
      confirm dialog (confirm → `downloadAndInstall()` + `relaunch()` unchanged);
      on "Later" (decline) route through `updateStore.beginDownload(update)` so the
      pill appears. Skip the prompt when that version is already staged.
- [ ] 3.2 Add `startUpdatePolling()`: a `setInterval` (3_600_000 ms) that calls
      `check()`, feeds the result + current status through `decideCheckAction`, and
      on `download` calls `updateStore.beginDownload(update)` — no dialog. Return a
      stop function. Keep everything behind the existing `inTauri()` guard and the
      best-effort try/catch (failures swallowed).

## 4. UI: pill + gift icon

- [ ] 4.1 Add a `gift` glyph (Lucide gift inner markup) to
      `src/lib/icons/projectIcons.ts`.
- [ ] 4.2 In `src/routes/+page.svelte`, render the pill as the FIRST child of
      `.tb-right`: `{#if updateStore.status === 'ready'}` →
      `<button class="update-pill">` with `<Icon name="gift" size={13}/>` +
      "Restart to update", `onclick={updateStore.restartToUpdate}`, a tooltip
      ("Version X ready"), and pointer-events re-enabled (the bar is a drag region).
- [ ] 4.3 Add orange pill styling in the page `<style>` (rounded, orange fill,
      readable contrast, sits left of the existing buttons).
- [ ] 4.4 In `onMount`, start `startUpdatePolling()` alongside the existing
      `checkForUpdateOnLaunch()`; clear the interval on teardown.

## 5. Verify

- [ ] 5.1 `npm run check` (0 errors) and `npm run test` (updater unit tests +
      full suite) green.
- [ ] 5.2 `openspec validate add-update-restart-pill` passes.
- [ ] 5.3 Manual (live in-app, headless-exempt): with a lower local version vs the
      published release, confirm the pill appears after a staged download and that
      clicking it installs + relaunches into the new version; confirm no pill when
      up to date / offline.
