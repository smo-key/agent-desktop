## Context

The auto-update flow already exists (`add-desktop-release-ci`): `tauri.conf.json`
configures the updater plugin against the GitHub Releases `latest.json`, the
updater + process plugins are registered in `lib.rs`, and
`src/lib/updates/checkForUpdate.ts` runs a single launch check behind an
`inTauri()` guard, branching through the pure `decideUpdateAction` in `decide.ts`.
The title bar is inline in `src/routes/+page.svelte` (`<header class="titlebar">`),
with right-side controls in `.tb-right`. Icons are vendored inline SVG via
`Icon.svelte` + `projectIcons.ts` (no `gift` glyph yet).

The `@tauri-apps/plugin-updater` `Update` object exposes **separate** `download()`
and `install()` calls (not only `downloadAndInstall()`), which is exactly what the
"download in the background, restart to install" UX needs.

## Goals / Non-Goals

**Goals:**
- A non-intrusive, always-visible "Restart to update" affordance once an update is
  staged, on the user's schedule.
- Detect updates published while the app runs (hourly), not just at launch.
- Download the (large) bundle in the background so the click-to-restart is instant.
- Preserve the existing launch dialog; never block startup; never surface errors.
- Keep the branching logic in a pure, headless-testable seam.

**Non-Goals:**
- No download-progress UI, no "checking…" indicator, no settings toggle for the
  cadence (fixed ~1h).
- No dismiss/snooze of the pill (it persists until restart).
- No change to signing, the updater endpoint, or any Rust code.
- No Windows-specific work (Windows builds remain best-effort upstream).

## Decisions

- **State lives in a rune store** (`updateStore.svelte.ts`): `status: 'idle' |
  'downloading' | 'ready'`, `version`, and a handle to the staged `Update`. The
  pill renders on `status === 'ready'`. `restartToUpdate()` calls
  `update.install()` then `relaunch()`. Outside Tauri / on any failure it stays
  `idle`, so the pill simply never appears. Centralizing state lets both the
  launch path and the hourly poll feed one source of truth (and dedupe).
- **Pure decision seam** (`decide.ts`): add `decideCheckAction(update, status)`
  returning `{ kind: 'ignore' }` (no update, or we already have this version
  downloading/ready) or `{ kind: 'download'; update }`. Unit-tested in
  `decide.test.ts`; keeps the "should we start a background download?" logic out
  of the IPC-bound code, matching the existing pattern.
- **Background download helper** shared by both entry points: set
  `status='downloading'`, `await update.download()`, set `status='ready'` + stash
  the `Update`. Wrapped in try/catch → on failure reset to `idle`.
- **Launch path** (`checkForUpdateOnLaunch`, kept): confirm → `downloadAndInstall()`
  + `relaunch()` immediately (unchanged). "Later" → run the background-download
  helper → pill. Guard so a second prompt isn't shown for a version already staged.
- **Hourly poll** (`startUpdatePolling`): `setInterval(check, 3_600_000)`; on a new
  update run the background-download helper — **no dialog**. Returns a stop fn;
  `+page.svelte` starts it in `onMount` and clears it on teardown. First tick at
  t=1h (launch check covers t=0).
- **Pill UI**: first child of `.tb-right` (leftmost of the right cluster),
  `{#if updateStore.status === 'ready'}`, `<button class="update-pill">` with
  `<Icon name="gift" size={13}/>` + "Restart to update", orange fill, tooltip
  "Version X ready", `onclick={updateStore.restartToUpdate}`. Opts back into
  pointer events like the sibling buttons (the bar is a drag region).
- **Gift icon**: add Lucide `gift` inner markup to `projectIcons.ts` so it matches
  the stroke-icon design system (not an emoji).

## Risks / Trade-offs

- **Auto-download uses bandwidth without an explicit click.** Accepted: it is the
  premise of "download in background, restart to install," matches Chrome/VS Code,
  and only runs after an update is genuinely available.
- **Concurrent downloads must not corrupt state or leak handles.** `beginDownload`
  is the single mutation point and is concurrency-safe: a monotonic `seq` token
  means only the latest download commits `staged`/`status`, so `version` (shown in
  the pill) and `staged` (what `install()` applies) never disagree under a
  supersede; and an in-`beginDownload` version dedupe drops a duplicate handle (a
  launch-vs-poll race). Tauri's `Update` is a Rust-backed `Resource` (`rid` freed
  only by `close()` or app exit), so EVERY handle we don't install — superseded,
  failed, duplicate, or an hourly re-check of an already-staged version — is
  `close()`d (`resource.ts`), avoiding a ~1/hour resource leak while an update sits
  staged.
- **Restart is re-entrancy-guarded.** `restartToUpdate` flips `status` to
  `installing` synchronously before the first `await`, so a double-click can't
  double-`install()`/`relaunch()`; the pill (shown only on `ready`) also
  disappears during install.
- **A hung `download()` that never settles wedges `downloading`.** Accepted
  limitation (no timeout passed): best-effort, and a genuinely newer release
  supersedes it; a same-version retry after a network black-hole is an edge case
  we don't actively recover within a session.
- **`install()`/`relaunch()`/`close()` are not headless-testable as live IPC.**
  Isolated behind the store + `inTauri()` guard; the pure decision and the store
  transitions (using fake `Update` handles) ARE unit-tested. The live
  install+relaunch and the rendered pill are MANUAL-verify (this capability is not
  in the scenario-coverage enforced set).
- **A failed background download leaves no pill.** Intentional — silent best-effort,
  retried on the next hourly tick.
