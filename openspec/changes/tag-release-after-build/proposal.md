## Why

The release workflow pushed the annotated `v<version>` tag in the `gate` job,
before any build ran. That tag is also the idempotency marker `release-gate.sh`
keys on, so a single failed build leg (v0.3.2's Windows leg, 2026-09-08)
permanently "burned" the version: the gate refused to retry, and the
`force_publish` escape hatch died at `git tag -a` because the tag already
existed. Recovering required hand-deleting the tag and draft Release.

## What Changes

- `gate` still syncs manifests and pushes the `[skip ci]` sync commit, but no
  longer tags. It exports the sync commit's sha (`release_sha`) for every
  downstream job.
- `create-release` deletes any stale draft Release for the same tag left by a
  previous failed attempt, refuses to proceed if a *published* Release already
  exists for the tag, and creates the draft pinned to `release_sha`.
- `build` checks out `release_sha` instead of the (now non-existent) tag.
- `publish-release` creates and pushes the annotated tag on `release_sha` and
  only then undrafts the Release. The tag is therefore the last artifact of a
  fully successful pipeline.
- Header, job comments, and README release docs describe the new ordering and
  the corrected semantics of `force_publish` / `bundle_test`.

## Capabilities

### Modified Capabilities

- `release-pipeline`: tag creation moves from before the build to after every
  target has built; failed attempts are retryable without manual cleanup.
