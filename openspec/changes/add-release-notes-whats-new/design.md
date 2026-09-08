# Design

## Changelog format and parsing

`CHANGELOG.md` is the single source for both the GitHub Release body and the
in-app dialog. A version section starts at a line `## <version>` (optionally
followed by ` — <date>` or anything else on the line) and runs to the next
`## ` heading or end of file. The parser lives in a plain-JS module,
`src/lib/changelog/section.mjs`, so it is shared by:

- `scripts/release-notes.mjs` (plain Node in CI; prints the section, exits 1
  when missing), and
- the app (`src/lib/changelog/releaseNotes.ts`), which imports the module and
  the changelog text via Vite's `?raw` import of `../../../CHANGELOG.md`.

`sectionFor(md, version)` returns the section body or `''`. `newestSection(md)`
returns the first section (used by dev builds, which have no release version).
`parseNotes(body)` turns a section body into `{ heading, items }[]`, where an
item is a list of inline runs (`text`, `bold`, `code`, `link`) so the dialog
renders Svelte markup, never `innerHTML`.

## Seen-version state

`src/lib/changelog/whatsNewStore.svelte.ts` holds `open`, `version`, and the
parsed notes, plus `maybeShowOnLaunch(settings)`. The seen version persists as
the `whatsNew: { seenVersion }` slice of `settings.json` through
`saveSettingsSlice` (localStorage is banned by `lint:storage`).

Rules, in order:

1. Dev build (`import.meta.env.DEV`) → never auto-open.
2. `seenVersion === version` → nothing.
3. No `seenVersion` **and** the settings object is empty → fresh install:
   record the version silently (onboarding is on screen; there is no "update").
4. Otherwise record the version and open the dialog **if** the changelog has a
   section for it. No section → stay quiet.

`+page.svelte` calls `maybeShowOnLaunch` from its `onMount` after the other
settings slices load, using the settings object already fetched there.

## Dialog and Settings

`WhatsNewModal.svelte` mirrors `HelpModal.svelte` (backdrop, Esc, close button,
"Got it"). Title: "What's new in Agent Desktop v<version>". In Settings the
footer version label and the update row's version text become buttons that
call `whatsNew.show()`; a dev build shows the newest section under the label
"dev".

## Release pipeline

`release.yml` gate job: replace the git-cliff install + generate steps with
`node scripts/release-notes.mjs "$VERSION" > RELEASE_NOTES.md`, placed before
the commit + tag step. `CHANGELOG.md` leaves the `git add` list (it is
authored in the release commit by the task, not generated). `cliff.toml` and
the git-cliff comments go. README's Releases section describes the new flow.

## Release task prompt

Adapted from headway: gate with `yarn check:gate`; choose the version (use the
package.json version when it is already above the latest tag, else bump patch);
write the section from `git log <last-tag>..HEAD` plus uncommitted changes,
skipping internal chores; bump `package.json` only (CI syncs the rest); commit
as `chore(release): prepare vX.Y.Z`; push to `main`, or open a PR when not on
`main`. It never creates the tag.
