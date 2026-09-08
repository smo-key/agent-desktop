# Tasks

## 1. Changelog + parser

- [x] 1.1 Convert `CHANGELOG.md` to the curated format (header text, `## <version> — <date>` headings for the existing sections); delete `cliff.toml`.
- [x] 1.2 `src/lib/changelog/section.mjs`: `sectionFor`, `newestSection`, `parseNotes` with tests in `section.test.ts` (scenario-titled).
- [x] 1.3 `scripts/release-notes.mjs`: prints the section for `<version|vversion>`, exit 1 with a clear message when missing.

## 2. Release pipeline + task

- [x] 2.1 `release.yml`: drop git-cliff, generate `RELEASE_NOTES.md` via the script before the commit + tag step, remove `CHANGELOG.md` from the sync commit; update comments and README "Releases".
- [x] 2.2 `.agent-desktop/tasks.json`: replace the `Release` task prompt with the headway-style flow adapted to this repo; test asserts the prompt's required points.

## 3. In-app What's new

- [x] 3.1 `src/lib/changelog/releaseNotes.ts`: bundle `CHANGELOG.md` (`?raw`), resolve notes for the running version / dev.
- [x] 3.2 `src/lib/changelog/whatsNewStore.svelte.ts`: open/close, `maybeShowOnLaunch(settings)` with the seen-version rules; `whatsNew` settings slice via `saveSettingsSlice`; scenario-titled tests.
- [x] 3.3 `WhatsNewModal.svelte` (mirrors HelpModal); mount in `+page.svelte`; call `maybeShowOnLaunch` on mount.
- [x] 3.4 Settings: footer version + update-row version become buttons that open the dialog.
- [x] 3.5 Add `whats-new-dialog` to the coverage gate's enforced set; the rendered modal (markup + Esc/backdrop/"Got it" dismissal) is covered by a jsdom component test (`WhatsNewModal.svelte.test.ts`, Svelte browser build resolved under vitest in `vite.config.ts`).

## 4. Verify

- [x] 4.1 `yarn check:gate` green (the one red test, statusline-wrapper `cwd`, belongs to another session's uncommitted WIP in this shared worktree). The plain web build cannot stand in for the Tauri runtime, so the dialog's rendering is confirmed by the jsdom component test rather than a live `tauri dev` click; a live click of the version button remains a release-time smoke check.
