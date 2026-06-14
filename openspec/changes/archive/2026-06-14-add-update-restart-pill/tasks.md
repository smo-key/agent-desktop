## 1. Pure decision seam (TDD)

- [x] 1.1 In `src/lib/updates/decide.test.ts`, add failing cases for a new pure
      `decideCheckAction(update, status)`: returns `{ kind: 'ignore' }` when
      `update` is null; `{ kind: 'ignore' }` when the update's version equals the
      version already `downloading`/`ready`; `{ kind: 'download', update }` for a
      new version while `idle`. — 6 new cases (incl. supersede), all green.
- [x] 1.2 Implement `decideCheckAction` in `src/lib/updates/decide.ts` (data-only
      types, no IPC) until the new tests pass; keep `decideUpdateAction` intact.
      — added `UpdateStatus` + `CheckAction` types and the version-keyed dedupe.

## 2. Update store

- [x] 2.1 Add `src/lib/updates/updateStore.svelte.ts`: a rune store holding
      `status: 'idle' | 'downloading' | 'ready'`, `version: string | null`, and a
      private handle to the staged `Update`. Expose `restartToUpdate()` →
      `update.install()` then `relaunch()`, and a `beginDownload(update)` helper
      that sets `downloading`, awaits `update.download()`, sets `ready` (+ stashes
      the handle), and on any throw resets to `idle`. Plus a `snapshot` getter for
      the pure dedupe.
- [x] 2.2 Unit-test the headless-safe transitions (status/version setters and the
      `decideCheckAction`-driven dedupe) where they don't require the Tauri IPC;
      leave `install()`/`relaunch()`/`download()` as the MANUAL-verified seam.
      — `updateStore.svelte.test.ts`: idle start, downloading→ready, failure-resets,
      install-then-relaunch order (relaunch mocked), no-op when nothing staged.

## 3. Check orchestration

- [x] 3.1 Extend `src/lib/updates/checkForUpdate.ts`: on the launch check, keep the
      confirm dialog (confirm → `downloadAndInstall()` + `relaunch()` unchanged);
      on "Later" (decline) route through `updateStore.beginDownload(update)` so the
      pill appears. Skip the prompt when that version is already staged.
- [x] 3.2 Add `startUpdatePolling()`: a `setInterval` (3_600_000 ms) that calls
      `check()`, feeds the result + current status through `decideCheckAction`, and
      on `download` calls `updateStore.beginDownload(update)` — no dialog. Return a
      stop function. Keep everything behind the existing `inTauri()` guard and the
      best-effort try/catch (failures swallowed). — `checkForUpdate.test.ts` covers
      the hourly tick, t=0 silence, stop(), no-update, throw, and non-Tauri no-op.

## 4. UI: pill + gift icon

- [x] 4.1 Add a `gift` glyph (Lucide gift inner markup) to
      `src/lib/icons/projectIcons.ts`.
- [x] 4.2 In `src/routes/+page.svelte`, render the pill as the FIRST child of
      `.tb-right`: `{#if updateStore.status === 'ready'}` →
      `<button class="update-pill">` with `<Icon name="gift" size={13}/>` +
      "Restart to update", `onclick={() => void updateStore.restartToUpdate()}`, a
      tooltip ("Agent Desktop X is ready"), pointer-events re-enabled.
- [x] 4.3 Add orange pill styling in the page `<style>` — solid `--orange-500`
      fill, dark text for contrast, `--glow-orange` on hover; sits left of the
      existing buttons.
- [x] 4.4 In `onMount`, start `startUpdatePolling()` alongside the existing
      `checkForUpdateOnLaunch()`; clear the interval on teardown (return block).

## 5. Verify

- [x] 5.1 `npm run check` (0 errors) and `npm run test` (updater unit tests +
      full suite) green. — svelte-check 0 errors; vitest 1161 passed (113 files),
      incl. 20 in `src/lib/updates/`.
- [x] 5.2 `openspec validate add-update-restart-pill` passes.
- [ ] 5.3 Manual (live in-app, headless-exempt): with a lower local version vs the
      published release, confirm the pill appears after a staged download and that
      clicking it installs + relaunches into the new version; confirm no pill when
      up to date / offline. — PENDING: requires a packaged build vs a published
      release; release-time manual check (cannot be exercised headlessly).

## 6. Adversarial-review hardening

- [x] 6.1 CRITICAL: concurrency-safe `beginDownload` (monotonic `seq` token) so a
      superseding newer version keeps `version` consistent with the `staged` handle
      `install()` applies, and an in-flight/staged duplicate is dropped — covers
      the launch-vs-poll race. `updateStore.svelte.test.ts` supersede + dedupe cases.
- [x] 6.2 CRITICAL: close every un-installed `Update` handle (Rust `Resource`) —
      superseded, failed, duplicate, and the hourly already-staged re-check — via
      `resource.ts` `closeUpdate`, preventing a ~1/hour backend resource leak.
      Tested in both updates test files.
- [x] 6.3 CRITICAL: `restartToUpdate` flips `status` → `installing` synchronously
      before awaiting `install()`, so a double-click can't double-install/relaunch
      (and the pill hides during install). Regression test added.
- [x] 6.4 Re-run `npm run check` (0 errors) + `npm run test` (1166 passed) and
      `openspec validate` after the fixes.
