## Context

The auto-update pipeline (capability `desktop-auto-update`) is implemented across
`src/lib/updates/` and the `+page.svelte` title bar. Today the launch path calls
`ask()` from `@tauri-apps/plugin-dialog`, but the app capability grants only
`dialog:allow-open` — not `dialog:allow-ask` — so the IPC call is denied, throws,
and is swallowed by the surrounding `try/catch`. Because the throw happens before
the background-download fallback, neither the dialog nor the staged-update pill
ever appears: the updater is effectively dead. The server side is healthy (a
signed `latest.json` for the newer version is published and verifiable).

The existing store (`updateStore.svelte.ts`) already models
`idle → downloading → ready → installing` with a monotonic `seq` token guarding
concurrent downloads, and `decide.ts` holds pure decision logic
(`decideCheckAction` for download-vs-ignore, `decideUpdateAction` for the now-dead
dialog confirm). This change builds on that structure.

## Goals / Non-Goals

**Goals:**
- Remove the permission-denied dialog so the updater works at all.
- Make updating visible: progress in the title-bar pill, a retryable failure
  state, and an on-demand check in Settings.
- Keep installs user-initiated (no silent install) and preserve the existing
  staged-then-restart model and concurrency safety.

**Non-Goals:**
- Changing the release/CI pipeline, the manifest format, signing, or the
  `desktop-auto-update` capability's plugin/configuration requirements.
- Auto-installing without a user click.
- Healing the already-shipped `0.2.1` binary (impossible from code — documented
  caveat only).

## Decisions

**1. Remove the dialog; unify launch + hourly into one staging path.**
`checkForUpdateOnLaunch` stops calling `ask()`; on a found update it calls
`updateStore.beginDownload(update)` directly, exactly like the hourly poll. This
both fixes the bug (no `dialog:allow-ask` needed) and delivers the desired calm UX.
*Alternative considered:* grant `dialog:allow-ask` to repair the dialog — rejected
because the user wants no dialog, and the silent-swallow pattern would keep hiding
failures. The dead `decideUpdateAction` and the dialog import are removed; the
dialog plugin and `dialog:allow-open` stay (used by file pickers elsewhere).

**2. Progress via the updater's own events.** `update.download(onEvent)` emits
`Started{ contentLength? }`, `Progress{ chunkLength }`, `Finished`. `beginDownload`
accumulates `downloadedBytes` and records `totalBytes` from `Started`. `percent`
is `downloadedBytes / totalBytes` when total is known, else `null` (indeterminate).
We keep the staged-then-install split (`download()` then `install()` on pill
click) rather than `downloadAndInstall()`, preserving the "stage now, restart
later" model. These become reactive `$state` on the store so the pill re-renders.

**3. State model.** Extend `UpdateStatus` with `failed`. Add store fields
`downloadedBytes`, `totalBytes`, `percent`, and `lastError`, plus `retry()`. The
existing `seq` token still guards races (manual check vs hourly poll vs launch).

**4. Error policy split.** A *check* that throws (offline / IPC / no manifest) with
no update found leaves the store `idle` and surfaces nothing in the header — this
avoids an hourly "update failed" when simply offline with no update available. A
*download/stage* failure (an update was found, then `download()`/`install()` threw)
sets `failed` + `lastError`, lighting the header's retry affordance. The
user-initiated Settings check is the exception: it surfaces check failures inline
("Couldn't check — retry"), since the user explicitly asked.

**5. Pill morphs in place.** The single title-bar element renders for
`downloading | ready | failed | installing` and is hidden for `idle`:
`⟳ Updating… N%` (or indeterminate) → `🎁 Restart to update` → `⟳ Restarting…`;
`⚠ Update failed · retry` on failure. Only `ready` and `failed` are clickable.

**6. Settings "Check for updates."** A row shows the current version (reusing the
existing build-time `__APP_VERSION__` / `appVersionLabel`, the same source as the
Settings footer — consistent, and no extra IPC; the CI release sync keeps it in
step with the real app version) and a button runs a check that drives the same
store (so progress/ready/failed are shared and also light the header pill). The
Settings view derives its inline status from the shared store plus a
manual-check-specific signal for `up to date` / `couldn't check`. The check is the
shared `runUpdateCheck`, whose returned `CheckOutcome` the row maps to the inline
status; the same function is the store's injected `recheck` behind `retry()`.

## Risks / Trade-offs

- **Auto-download without an explicit "yes"** → Mitigation: this matches the prior
  "Later" path, which already staged in the background; install still requires
  clicking the pill, so nothing installs silently.
- **Manifest omits content length on some platforms** → Mitigation: indeterminate
  `Updating…` fallback; percent shown only when `totalBytes` is known.
- **Manual check and hourly poll racing** → Mitigation: the existing `seq`-token
  guard already serializes concurrent downloads; manual check reuses it.
- **Shipped 0.2.1 cannot self-heal** → Mitigation: documented; one-time manual
  install of a later build.

## Migration Plan

Ships in the next release; no data migration. Rollback would restore the broken
dialog path, so the intent is to roll forward, not back. Because the capability's
base spec still lives in the unarchived `add-desktop-release-ci` and
`add-update-restart-pill` changes, this change must be archived **after** both so
its MODIFIED requirements resolve against an existing durable spec.

## Open Questions

None blocking. (Version source = app API; retry = re-check then re-download.)
