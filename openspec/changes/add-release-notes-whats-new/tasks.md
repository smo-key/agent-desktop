# Tasks

## 1. Changelog + parser

- [ ] 1.1 Convert `CHANGELOG.md` to the curated format (header text, `## <version> — <date>` headings for the existing sections); delete `cliff.toml`.
- [ ] 1.2 `src/lib/changelog/section.mjs`: `sectionFor`, `newestSection`, `parseNotes` with tests in `section.test.ts` (scenario-titled).
- [ ] 1.3 `scripts/release-notes.mjs`: prints the section for `<version|vversion>`, exit 1 with a clear message when missing.

## 2. Release pipeline + task

- [ ] 2.1 `release.yml`: drop git-cliff, generate `RELEASE_NOTES.md` via the script before the commit + tag step, remove `CHANGELOG.md` from the sync commit; update comments and README "Releases".
- [ ] 2.2 `.agent-desktop/tasks.json`: replace the `Release` task prompt with the headway-style flow adapted to this repo; test asserts the prompt's required points.

## 3. In-app What's new

- [ ] 3.1 `src/lib/changelog/releaseNotes.ts`: bundle `CHANGELOG.md` (`?raw`), resolve notes for the running version / dev.
- [ ] 3.2 `src/lib/changelog/whatsNewStore.svelte.ts`: open/close, `maybeShowOnLaunch(settings)` with the seen-version rules; `whatsNew` settings slice via `saveSettingsSlice`; scenario-titled tests.
- [ ] 3.3 `WhatsNewModal.svelte` (mirrors HelpModal); mount in `+page.svelte`; call `maybeShowOnLaunch` on mount.
- [ ] 3.4 Settings: footer version + update-row version become buttons that open the dialog.
- [ ] 3.5 Add `whats-new-dialog` to the coverage gate's enforced set, with the DOM-only scenarios (click, close, dev newest render) listed as MANUAL.

## 4. Verify

- [ ] 4.1 `yarn check:gate` green; confirm the dialog live in `tauri dev` via the version button.
