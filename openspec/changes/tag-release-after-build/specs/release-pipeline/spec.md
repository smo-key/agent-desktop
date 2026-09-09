## MODIFIED Requirements

### Requirement: Release triggers on a version bump to main

The release pipeline SHALL run on every push to `main` and on manual
`workflow_dispatch`. On a push, it SHALL determine the `version` from
`package.json` at the pushed commit and SHALL proceed with a release **only when**
that version is strictly greater than the highest existing `v*` release tag and no
`v<version>` tag already exists. Otherwise it SHALL complete without creating a
tag, build, or release. Because the tag is created only at the very end of a
successful pipeline, a release attempt that fails before publishing leaves no
tag behind and the same version is retried by the next run.

#### Scenario: Version bumped on main

- **WHEN** a commit is pushed to `main` whose `package.json` version is higher
  than the latest `v*` tag
- **THEN** the pipeline proceeds to sync, build, tag, and publish a release for
  that version

#### Scenario: Push with no version change

- **WHEN** a commit is pushed to `main` whose `package.json` version equals the
  latest `v*` tag
- **THEN** the pipeline completes without tagging, building, or publishing

#### Scenario: Tag already exists

- **WHEN** a release run would create `v<version>` but that tag already exists
- **THEN** the pipeline does not re-release and exits successfully (idempotent)

#### Scenario: Failed attempt is retried without manual cleanup

- **WHEN** a release attempt for version `X` fails after the sync commit but
  before publishing (a build leg fails)
- **THEN** no `vX` tag exists, and the next push to `main` or manual dispatch
  re-attempts the release for `X` without any tag or Release having to be deleted
  by hand

#### Scenario: Manual dispatch

- **WHEN** a maintainer triggers the workflow via `workflow_dispatch`
- **THEN** the pipeline runs, honoring a publish/no-publish input so a build can
  be produced for testing without publishing a release

### Requirement: Version is single-sourced from package.json and tagged

On a release run, the pipeline SHALL set the version in
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `Cargo.lock` to match
`package.json`, commit the result to `main` with a message containing
`[skip ci]`, and record that sync commit's sha as the single commit every
downstream job builds, releases, and tags. The annotated tag `v<version>` SHALL
be created on that commit and pushed **only after every build target has
succeeded**, immediately before the Release is published.

#### Scenario: Manifests synced and committed

- **WHEN** a release runs for version `X`
- **THEN** `tauri.conf.json`, `Cargo.toml`, and `Cargo.lock` are updated to `X`
  and committed to `main` with a `[skip ci]` release message, and no tag is
  created at this point

#### Scenario: Sync commit does not start a new release

- **WHEN** the `[skip ci]` version-sync commit lands on `main`
- **THEN** no new release run is started for it (skip-ci marker and the
  idempotency guard both prevent a loop)

#### Scenario: Builds use the sync commit

- **WHEN** the build matrix runs for version `X`
- **THEN** every target checks out the recorded sync commit sha, not `main` and
  not a tag, so a push to `main` during the build cannot change what is released

#### Scenario: Annotated tag created after a fully successful build

- **WHEN** every build target for version `X` has built and uploaded its
  installers
- **THEN** an annotated tag `vX` is created on the sync commit and pushed, and
  only then is the Release published

#### Scenario: No tag when a target fails

- **WHEN** any build target for version `X` fails
- **THEN** no `vX` tag is created or pushed

### Requirement: Single GitHub Release with all platform artifacts

The pipeline SHALL create exactly one GitHub Release per version, tagged
`v<version>`, as a **draft** up front pinned to the sync commit, attach every
successful target's installers to it, and then **publish (undraft)** it once the
build matrix completes successfully for **all four targets** and the tag has
been pushed. If any target fails the release SHALL remain a draft with no tag.
When creating the draft, the pipeline SHALL delete any stale draft Release for
the same tag left by a previous failed attempt, and SHALL fail without touching
it if a published Release for that tag already exists.

#### Scenario: Release published with attachments

- **WHEN** the build matrix completes for version `X` with all four targets
  succeeding
- **THEN** the tag `vX` is pushed and the single GitHub Release `vX` is flipped
  from draft to published with every platform's installer(s) attached, including
  the Windows installer

#### Scenario: Release stays a draft when a target fails

- **WHEN** any target fails to build for version `X`
- **THEN** the release `vX` remains a draft, is not published, and no `vX` tag
  exists

#### Scenario: Stale draft from a failed attempt is replaced

- **WHEN** a release attempt for version `X` starts and a draft Release `vX`
  from an earlier failed attempt still exists
- **THEN** the stale draft (and its partial assets) is deleted and a fresh draft
  `vX` is created, so exactly one Release exists for the version

#### Scenario: Published release is never clobbered

- **WHEN** a release attempt for version `X` finds a **published** Release `vX`
- **THEN** the attempt fails before creating or deleting anything
