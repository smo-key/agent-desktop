## MODIFIED Requirements

### Requirement: Release triggers on a version bump to a release branch

The release pipeline SHALL run on every push to a **release branch** — `main` (the stable lane) or `beta` (the beta lane) — and on manual `workflow_dispatch`.

On a push, it SHALL determine the `channel` from the pushed branch (`main` →
`stable`, `beta` → `beta`), determine the `version` from `package.json` at the
pushed commit, and SHALL proceed with a release **only when** that version is a
valid candidate for the channel (see "Channel-partitioned release gate") and no
`v<version>` tag already exists. Otherwise it SHALL complete without creating a
tag, build, or release.

Because the tag is created only at the very end of a successful pipeline, a
release attempt that fails before publishing leaves no tag behind and the same
version is retried by the next run — on either lane.

#### Scenario: Version bumped on main

- **WHEN** a commit is pushed to `main` whose `package.json` version is higher
  than the latest stable `v*` tag
- **THEN** the pipeline proceeds to sync, build, tag, and publish a stable
  release for that version

#### Scenario: Version bumped on beta

- **WHEN** a commit is pushed to `beta` whose `package.json` version is a
  prerelease higher than every existing tag
- **THEN** the pipeline proceeds to sync, build, tag, and publish a **prerelease**
  release for that version

#### Scenario: Push with no version change

- **WHEN** a commit is pushed to a release branch whose `package.json` version
  equals the latest tag for that channel
- **THEN** the pipeline completes without tagging, building, or publishing

#### Scenario: Tag already exists

- **WHEN** a release run would create `v<version>` but that tag already exists
- **THEN** the pipeline does not re-release and exits successfully (idempotent)

#### Scenario: Failed attempt is retried without manual cleanup

- **WHEN** a release attempt for version `X` fails after the sync commit but
  before publishing (a build leg fails)
- **THEN** no `vX` tag exists, and the next push to that release branch or manual
  dispatch re-attempts the release for `X` without any tag or Release having to
  be deleted by hand

#### Scenario: Manual dispatch

- **WHEN** a maintainer triggers the workflow via `workflow_dispatch`
- **THEN** the pipeline runs on the dispatched branch, honoring a
  publish/no-publish input so a build can be produced for testing without
  publishing a release

### Requirement: Version is single-sourced from package.json and tagged

On a release run, the pipeline SHALL set the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `Cargo.lock` to match `package.json`, commit the result to **the release branch the run was triggered from**, with a message containing `[skip ci]`, and record that sync commit's sha as the single commit every downstream job builds, releases, and tags.

The annotated tag `v<version>` SHALL be created on that commit and pushed **only
after every build target has succeeded**, immediately before the Release is
published. Because a beta version is a semver prerelease, its tag carries the
prerelease suffix verbatim (`v0.4.0-beta.1`), and the same suffix appears in
`tauri.conf.json` and `Cargo.toml` — the in-app updater compares a manifest
against the app's own compiled version, so all four must agree.

#### Scenario: Manifests synced and committed

- **WHEN** a release runs for version `X` on release branch `B`
- **THEN** `tauri.conf.json`, `Cargo.toml`, and `Cargo.lock` are updated to `X`
  and committed to `B` with a `[skip ci]` release message, and no tag is created
  at this point

#### Scenario: Sync commit does not start a new release

- **WHEN** the `[skip ci]` version-sync commit lands on a release branch
- **THEN** no new release run is started for it (skip-ci marker and the
  idempotency guard both prevent a loop)

#### Scenario: Builds use the sync commit

- **WHEN** the build matrix runs for version `X`
- **THEN** every target checks out the recorded sync commit sha, not a branch and
  not a tag, so a push during the build cannot change what is released

#### Scenario: Annotated tag created after a fully successful build

- **WHEN** every build target for version `X` has built and uploaded its
  installers
- **THEN** an annotated tag `vX` is created on the sync commit and pushed, and
  only then is the Release published

#### Scenario: Prerelease version is carried verbatim

- **WHEN** a beta release runs for version `0.4.0-1`
- **THEN** `tauri.conf.json` and `Cargo.toml` are set to `0.4.0-1` and the
  tag created is `v0.4.0-1`

#### Scenario: No tag when a target fails

- **WHEN** any build target for version `X` fails
- **THEN** no `vX` tag is created or pushed

### Requirement: Single GitHub Release with all platform artifacts

The pipeline SHALL create exactly one GitHub Release per version, tagged `v<version>`, as a **draft** up front pinned to the sync commit, attach every successful target's installers to it, and then **publish (undraft)** it once the build matrix completes successfully for **all four targets** and the tag has been pushed.

A release on the beta lane SHALL be marked `prerelease: true`, and a release on
the stable lane `prerelease: false`. The prerelease marking is load-bearing:
GitHub excludes prereleases from `releases/latest`, which is what keeps the
stable update endpoint — and the one-line installers, which also resolve
`releases/latest` — pointing at stable builds only.

If any target fails the release SHALL remain a draft with no tag. When creating
the draft, the pipeline SHALL delete any stale draft Release for the same tag
left by a previous failed attempt, and SHALL fail without touching it if a
published Release for that tag already exists.

#### Scenario: Release published with attachments

- **WHEN** the build matrix completes for version `X` with all four targets
  succeeding
- **THEN** the tag `vX` is pushed and the single GitHub Release `vX` is flipped
  from draft to published with every platform's installer(s) attached, including
  the Windows installer

#### Scenario: Beta release is marked as a prerelease

- **WHEN** a release is published from the `beta` branch
- **THEN** the GitHub Release is marked as a prerelease
- **AND** `releases/latest` continues to resolve to the newest stable release, so
  stable users and the one-line installers are unaffected

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

## ADDED Requirements

### Requirement: Channel-partitioned release gate

The release gate SHALL partition the `v*` tag space by channel and compare versions with a **full semantic-version comparator that orders prereleases correctly**, so that the two lanes cannot interfere with each other.

- A **stable** candidate SHALL be a version with no prerelease suffix, and SHALL
  release only when it is strictly greater than the highest **suffix-free** `v*`
  tag. Prerelease tags SHALL be ignored entirely when computing that baseline.
- A **beta** candidate SHALL be a version that carries a prerelease suffix, and
  SHALL release only when it is strictly greater than the highest existing tag on
  **either** lane — so a beta can never be published that is already superseded
  by a shipped stable release.
- A prerelease identifier SHALL additionally be a **single number no greater than
  65535**, the form the Windows MSI bundler accepts. The gate SHALL reject any
  other prerelease form, because `tauri build` discovers it only after compiling
  the binary — minutes into the Windows leg, with the other three platforms
  already built and uploaded.
- A version whose form does not match its branch's channel (a prerelease pushed
  to `main`, or a suffix-free version pushed to `beta`) SHALL NOT release, and
  the gate SHALL report the mismatch as its reason and still exit successfully.

Truncating the prerelease suffix before comparing — the previous behavior — is
explicitly forbidden: it makes consecutive betas compare equal, and, once any
prerelease tag exists, makes a stable bump to the same base version compare equal
to it, silently stopping the stable lane.

#### Scenario: Consecutive betas both release

- **WHEN** the beta lane has already tagged `v0.4.0-1` and `package.json` on
  `beta` is bumped to `0.4.0-2`
- **THEN** the gate decides to release, because `0.4.0-2` is strictly greater
  than `0.4.0-1`

#### Scenario: Stable lane ignores prerelease tags

- **WHEN** tags `v0.3.2` and `v0.4.0-5` exist and `package.json` on `main`
  is bumped to `0.4.0`
- **THEN** the gate decides to release `0.4.0`, because the stable baseline is
  `v0.3.2` and the prerelease tag is not considered

#### Scenario: Beta must outrank the newest stable

- **WHEN** stable `v0.5.0` has shipped and `package.json` on `beta` is set to
  `0.4.0-9`
- **THEN** the gate declines to release, because the beta candidate does not
  exceed the highest existing tag

#### Scenario: A prerelease the Windows bundler rejects never starts a build

- **WHEN** a version whose prerelease identifier is not a single number no
  greater than 65535 (such as `0.4.0-beta.1`) is pushed to `beta`
- **THEN** the gate declines to release and its reason names the required form,
  rather than the pipeline discovering it minutes into the Windows build with the
  other three platforms already built and uploaded

#### Scenario: Version form must match the branch

- **WHEN** a prerelease version is pushed to `main`, or a suffix-free version is
  pushed to `beta`
- **THEN** the gate declines to release, reports the channel/version mismatch as
  its reason, and exits successfully rather than failing the workflow

### Requirement: The beta update manifest is served from a pinned release

After a beta release is published, the pipeline SHALL republish that release's `latest.json` update manifest as the sole asset of a pinned prerelease tagged `beta-channel`, so the beta update endpoint has a stable URL that GitHub itself does not provide for "the newest prerelease".

The refresh SHALL **delete and recreate** the `beta-channel` release rather than
replacing its asset in place, so the manifest is served from a fresh asset URL
with no stale-CDN window. It SHALL run only **after** the versioned beta Release
has been published — that is, after all four build legs have finished writing
their entries into `latest.json` — so the pinned manifest is never a partially
populated one. The pinned release SHALL itself be marked as a prerelease, so it
can never become `releases/latest`.

A stable release SHALL NOT touch the `beta-channel` release: a stable build that
outranks the current beta reaches beta users through the client's
highest-version-wins comparison, not by rewriting the beta manifest.

#### Scenario: Beta manifest refreshed after publish

- **WHEN** a beta release `vX` is published with all four targets' updater
  artifacts attached
- **THEN** the `beta-channel` release is deleted and recreated as a prerelease
  holding that release's `latest.json`
- **AND** `releases/download/beta-channel/latest.json` serves the manifest for
  `X`

#### Scenario: Beta manifest is not refreshed from a failed run

- **WHEN** a beta release attempt fails before publishing
- **THEN** the `beta-channel` release is left exactly as it was, still serving
  the previous beta's manifest

#### Scenario: Stable release leaves the beta manifest alone

- **WHEN** a stable release is published
- **THEN** the `beta-channel` release is not modified
