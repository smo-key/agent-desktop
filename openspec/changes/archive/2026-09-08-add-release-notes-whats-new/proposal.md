# Curated release notes + in-app "What's new"

## Why

Release notes today are a raw dump of conventional-commit subjects grouped by
type (git-cliff). They read as a git log, not as a description of what changed
for the person using the app, and nothing in the app ever shows them. The
sibling project headway solves both halves: the Release agent task writes a
short, human-facing CHANGELOG.md section per version, the release workflow uses
that section verbatim as the GitHub Release body, and the app opens the same
notes once after each update (and any time the version number is clicked).
Agent Desktop should work the same way.

## What Changes

- **CHANGELOG.md becomes hand-curated.** One `## <version> — <YYYY-MM-DD>`
  section per release, newest first, with short `### New` / `### Improved` /
  `### Fixed` / `### Removed` sections and one bold-titled bullet per notable
  change. The existing git-cliff sections are converted to the new heading form
  so the file parses uniformly. `cliff.toml` is deleted.
- **The Release agent task authors the notes.** The `Release` task in
  `.agent-desktop/tasks.json` gets a prompt that runs the quality gate, picks
  the next version, writes the CHANGELOG section for everything since the last
  tag, bumps `package.json`, commits, and pushes to `main` (or opens a PR to it).
  CI still syncs the Tauri manifests and creates the tag.
- **The release body comes from CHANGELOG.md.** A new
  `scripts/release-notes.mjs` prints the section for one version. The gate job
  runs it before committing/tagging and fails when the section is missing, so a
  version whose notes were forgotten is never burned. git-cliff is removed from
  the workflow.
- **In-app "What's new" dialog.** The changelog is inlined at build time. On
  launch, when the running version differs from the last version the user has
  seen (and this is not a fresh install or a dev build), the app opens a modal
  with that version's notes. The version label in Settings becomes a button
  that reopens the dialog at any time.

## Capabilities

- `release-changelog` (MODIFIED): curated changelog, release body from the
  matching section, Release task authoring.
- `whats-new-dialog` (ADDED): section lookup, once-per-version auto-open,
  reopen from Settings.

## Out of scope

- A link from the dialog to the GitHub releases page (the app has no external
  URL opener yet).
- Rendering arbitrary Markdown; the dialog understands headings, bullets, bold,
  inline code and links only, which is all the CHANGELOG format uses.
