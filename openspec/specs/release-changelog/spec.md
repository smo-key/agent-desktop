# release-changelog Specification

## Purpose
Human-facing release notes: a hand-curated CHANGELOG.md section per version, authored by the Release task, used verbatim as the GitHub Release body and shown in-app after an update.
## Requirements
### Requirement: Grouped release notes from conventional commits

The pipeline SHALL use the `## <version>` section of `CHANGELOG.md` as the GitHub Release body, extracted by `scripts/release-notes.mjs`, and SHALL fail the gate job before any commit or tag is created when that section is missing.

#### Scenario: Release notes generated

- **WHEN** a release is published for version `X`
- **THEN** the Release body is the body of the `## X` section of `CHANGELOG.md`, trimmed

#### Scenario: Missing section fails before tagging

- **WHEN** the gate job runs for version `X` and `CHANGELOG.md` has no `## X` section
- **THEN** the job fails with a message naming the missing section and no release commit or `vX` tag is created

#### Scenario: Section lookup accepts a v prefix

- **WHEN** `scripts/release-notes.mjs` is run with `v1.2.3`
- **THEN** it prints the `## 1.2.3` section body

### Requirement: Maintained CHANGELOG.md

`CHANGELOG.md` SHALL be hand-curated: one `## <version> — <YYYY-MM-DD>` section per release, newest first, with short `### New` / `### Improved` / `### Fixed` / `### Removed` sections as needed and one bold-titled bullet per notable change. The pipeline SHALL NOT regenerate it.

#### Scenario: Changelog committed with the release

- **WHEN** a release runs for version `X`
- **THEN** the release commit does not modify `CHANGELOG.md`; the `## X` section was authored before the version bump landed on `main`

#### Scenario: Changelog and release notes are consistent

- **WHEN** a release is published for version `X`
- **THEN** the Release body and the in-app notes for `X` are both the `## X` section of `CHANGELOG.md`

### Requirement: Release task authors the notes

The project's `Release` agent task in `.agent-desktop/tasks.json` SHALL instruct the agent to run the quality gate, choose the next version, write the `## <version> — <date>` CHANGELOG section for everything since the last tag, bump `package.json`, commit, and push to `main` (or open a PR to `main`), without creating the tag.

#### Scenario: Release task prompt covers the flow

- **WHEN** the `Release` task definition is read
- **THEN** its prompt mentions the quality gate, the CHANGELOG section format, bumping `package.json`, pushing to `main`, and that CI creates the tag
