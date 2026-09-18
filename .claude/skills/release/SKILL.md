---
name: release
description: Use when cutting or preparing an Agent Desktop release — a stable release, a beta, or promoting a beta to stable — or when a release run failed and needs diagnosing. Covers both release branches.
---

# Release

Prepares a release and hands it to CI. **You never build, tag, or publish
anything yourself** — you push a version bump to a release branch and
`.github/workflows/release.yml` does the rest.

## The two lanes

| | Stable | Beta |
| --- | --- | --- |
| Branch | `main` | `beta` |
| Version form | `0.4.0` (no suffix) | `0.4.0-2` (**single integer** suffix) |
| Must outrank | highest suffix-free tag | highest tag on **either** lane |
| GitHub Release | normal → becomes `releases/latest` | **prerelease** → never `releases/latest` |
| Update manifest | `releases/latest/download/latest.json` | `beta-latest.json` on the `beta` branch |

The version's *form* selects the lane, and the gate enforces the pairing: a
prerelease pushed to `main`, or a plain version pushed to `beta`, releases
nothing.

**`-beta.1` is not a legal version here.** The Windows MSI bundler requires a
numeric-only prerelease identifier ≤ 65535, so betas are `-1`, `-2`, `-3`.

## Steps

1. **Pick the lane** from what is being released. If the request is ambiguous
   ("cut a release"), ask — the lanes are not interchangeable.

2. **Run the quality gate** — `yarn check:gate`. Stop on any failure. CI runs
   this again on every build leg, so a failure here is a failure there, 20
   minutes later.

3. **Choose the version, then PROVE it** before writing it anywhere:

   ```bash
   DRY_RUN=1 VERSION=<version> CHANNEL=<stable|beta> ./scripts/release-gate.sh
   ```

   This is the same code CI runs, and it is the authority on whether a version
   is releasable. `should_release: true` means go; anything else prints a
   `reason` that names the correct form. **Never push a version this refuses** —
   the refusals below are the ones it catches, and each costs a full CI round
   trip to discover any other way.

4. **Write the release notes** — a new `## <version> — <YYYY-MM-DD>` section at
   the top of `CHANGELOG.md`, above the previous one. Short `### New` / `### Improved` /
   `### Fixed` / `### Removed` groups; one bullet per notable change, bold title
   then a short user-facing description:

   `- **Worktree sessions**: start a session in a fresh git worktree from the launcher.`

   Cover everything since the last release *on that lane*
   (`git log <last-tag>..HEAD`). Skip internal chores, refactors and CI work.
   The section is used verbatim as the GitHub Release body and shown in-app in
   "What's new", and **CI hard-fails if it is missing**.

5. **Bump `package.json` only.** CI's `sync-version.sh` propagates the version
   into `tauri.conf.json`, `Cargo.toml` and `Cargo.lock`.

6. **Commit and push to the lane's branch.**
   - Subject: `chore(release): prepare v<version>`. No `[skip ci]` — that would
     suppress the release.
   - **Never open a PR from `beta` to `main`.** `beta` is a long-lived release
     lane, not a feature branch; its prerelease version is invalid on `main`.
   - This repo is a **shared checkout** — other sessions share HEAD and the
     index. Never `git checkout` another branch in it. Use a throwaway worktree:
     `git worktree add <scratch>/release-beta beta`, work there, remove it after.
   - **Do not create the tag.** CI creates `v<version>` only after all four
     targets have built. That is what makes a failed run retryable on the same
     version.

7. **Watch the run** (`gh run list --workflow=release.yml --branch <branch>`).
   It is not released until it is green. See "Verify after the run".

## What CI does after the push

gate (decides + syncs manifests + commits `[skip ci]`) → draft Release (marked
prerelease on the beta lane) → four build legs, all required → tag → publish →
**beta lane only**: the manifest is repointed at the release's tag and committed
to `beta-latest.json` on `beta`.

A failure anywhere before the tag leaves **no tag**, so the *same version*
retries on the next push. Nothing is burned; delete the leftover draft.

## Verify after the run

```bash
gh run view <id> --json conclusion,jobs -q '.conclusion'
gh api repos/smo-key/agent-desktop/releases/latest --jq '.tag_name'   # must stay stable
curl -sI https://raw.githubusercontent.com/smo-key/agent-desktop/beta/beta-latest.json   # beta lane
```

- Stable: `releases/latest` is the new tag.
- Beta: `releases/latest` is **unchanged**, and `beta-latest.json` reports the
  new version with URLs under `/releases/download/v<version>/`.

## Promoting a beta to stable

On `main`, set the version to the plain `0.4.0` and **write a new
`## 0.4.0` section** consolidating the beta sections. A `## 0.4.0-1` heading does
*not* match `0.4.0` — the release would fail for a missing section, and in-app
release notes would be empty.

Afterwards, merge `main` into `beta` before the next beta, and note the next beta
must outrank the new stable tag (after `0.4.0` ships, the next beta is `0.5.0-1`).

## Gate refusals and what they mean

| `reason` says | Fix |
| --- | --- |
| `prerelease identifier the Windows MSI bundler rejects` | Use `-2`, not `-beta.2` |
| `is a prerelease; the stable lane releases only suffix-free versions` | Push it to `beta`, not `main` |
| `has no prerelease suffix; the beta lane releases only prereleases` | Add `-1`, or release on `main` |
| `is not greater than baseline` | A beta must beat the newest **stable** tag too |
| `tag ... already exists` | That version shipped. Bump — it can never be re-released |

## Common mistakes

- **Bumping the patch number on the beta lane.** The next beta after `0.4.0-1` is
  `0.4.0-2`, not `0.4.1`.
- **Creating the tag by hand.** It makes the version unreleasable forever.
- **Checking out `beta` in the main checkout.** It moves HEAD for every other
  session in this repo.
- **Assuming a published release is a working release.** On the beta lane the
  manifest step runs *after* publish; if it failed, the release exists and no one
  can receive it. Check the whole run is green, not just that the Release appeared.
- **Reusing a release tag name.** Releases here are immutable: a tag used by one
  is burned permanently, even after deleting the release and the tag.
