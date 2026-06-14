# release-changelog Specification

## Purpose
TBD - created by archiving change add-desktop-release-ci. Update Purpose after archive.
## Requirements
### Requirement: Grouped release notes from conventional commits

The pipeline SHALL generate the GitHub Release body from the conventional commits
between the previous release tag and the new one, using a pinned `git-cliff` with
a committed `cliff.toml`, grouping entries by type (e.g. Features, Fixes, Docs).

#### Scenario: Release notes generated

- **WHEN** a release is published for version `X`
- **THEN** the Release body lists the commits since the previous tag, grouped by
  conventional-commit type

#### Scenario: First release with no previous tag

- **WHEN** a release is published and no previous `v*` tag exists
- **THEN** the notes are generated from the full history up to the release commit
  without failing

### Requirement: Maintained CHANGELOG.md

The pipeline SHALL regenerate `CHANGELOG.md` from the conventional-commit history
and include the updated file in the same version-sync release commit, so the
repository always carries an up-to-date changelog.

#### Scenario: Changelog committed with the release

- **WHEN** a release runs for version `X`
- **THEN** `CHANGELOG.md` is updated to include the `vX` entry and committed
  alongside the version-sync changes

#### Scenario: Changelog and release notes are consistent

- **WHEN** a release is published
- **THEN** the `vX` section of `CHANGELOG.md` and the GitHub Release body are
  derived from the same conventional-commit range

