# release-pipeline Specification

## Purpose
TBD - created by archiving change add-desktop-release-ci. Update Purpose after archive.
## Requirements
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

### Requirement: Multi-platform build matrix

The pipeline SHALL build the app natively for four targets — `aarch64-apple-darwin`,
`x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`, and
`aarch64-unknown-linux-gnu` — each on a runner of its own architecture, with
`fail-fast` disabled so one target's failure does not cancel the others. Linux
runners SHALL install the Tauri system dependencies before building. (The macOS
Intel target `x86_64-apple-darwin` is intentionally excluded: it requires the
`macos-13` Intel runner, which GitHub is retiring, and Apple-Silicon `.dmg`s
plus Rosetta cover Intel Macs.)

The Windows target is **best-effort**: its leg SHALL be `continue-on-error` so a
Windows build failure does NOT fail the build matrix or block the release. (The
Windows native build does not yet compile because `src-tauri` uses Unix-domain
sockets for its event + orchestration IPC; the Windows installer is restored once
that IPC is ported to named pipes.) macOS and Linux remain **required** — a
failure on either hard-fails the matrix and blocks publishing.

#### Scenario: All targets build their native installers

- **WHEN** a release builds
- **THEN** each matrix target produces its platform installer(s) (macOS `.dmg`,
  Windows `.msi`/NSIS `.exe`, Linux `.deb`/AppImage) built on a runner of the
  matching architecture

#### Scenario: One target fails

- **WHEN** one matrix target fails to build
- **THEN** the remaining targets continue and still produce their artifacts

#### Scenario: Windows is best-effort

- **WHEN** the Windows leg fails but macOS and Linux succeed
- **THEN** the build matrix still succeeds (Windows is `continue-on-error`) and
  the release is published with the macOS + Linux installers, without the Windows
  artifacts

#### Scenario: A required target fails

- **WHEN** the macOS or a Linux leg fails to build
- **THEN** the build matrix fails, the release is NOT published, and it stays a
  draft

### Requirement: Quality gate before packaging

Each build job SHALL run `yarn check:gate` (svelte-check, vitest, and scenario
coverage) and SHALL NOT package or publish an artifact if the gate fails.

#### Scenario: Gate fails

- **WHEN** `check:gate` fails on a build job
- **THEN** that job fails before packaging and no artifact for it is published

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

### Requirement: Build caching

The pipeline SHALL cache Cargo registry/target output and the built sidecar
binaries, keyed so a cache is reused until the lockfile, target triple, or pinned
sidecar source tags change.

#### Scenario: Unchanged inputs reuse cache

- **WHEN** a release builds with an unchanged `Cargo.lock` and unchanged pinned
  sidecar tags for a target
- **THEN** the cached Cargo output and prebuilt sidecars are restored instead of
  rebuilt from scratch

