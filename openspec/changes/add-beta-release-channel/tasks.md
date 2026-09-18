## 1. Release gate: prerelease-aware, channel-partitioned (TDD)

- [x] 1.1 Add `scripts/lib/version-compare.mjs` with pure `parseVersion`,
  `compareVersions` (full semver prerelease ordering), `isPrerelease`,
  `highestTag(tags, {prerelease})` and `decideRelease({version, channel, tags})`.
- [x] 1.2 Table-driven tests in `scripts/lib/version-compare.test.ts` covering the
  four gate scenarios (consecutive betas release; stable ignores prerelease tags;
  a beta must outrank the newest stable; a version whose form mismatches its
  branch does not release) plus the semver ordering edge cases.
- [x] 1.3 Rewrite `scripts/release-gate.sh` to take a `CHANNEL` (defaulting from
  `$GITHUB_REF_NAME`, else `stable`), delegate all version math to
  `version-compare.mjs`, and emit `should_release` / `version` / `tag` /
  `channel` — keeping the existing CLI contract (`VERSION=` override, `DRY_RUN=1`,
  exit 0 on a no-op).
- [x] 1.4 Confirm by hand: `DRY_RUN=1 VERSION=0.4.0-beta.1 CHANNEL=beta
  ./scripts/release-gate.sh` decides release, and the same version on `stable`
  does not.

## 2. Workflow: a second release lane

- [x] 2.1 Add `beta` to the push trigger.
- [x] 2.2 Derive the channel in `gate` and expose it as a job output.
- [x] 2.3 Push the sync commit to the branch the run was triggered from, not a
  hardcoded `main`.
- [x] 2.4 Set `prerelease` on the created draft Release from the channel.
- [x] 2.5 Add the `beta-channel` refresh step to `publish-release`: delete and
  recreate the pinned prerelease holding the just-published release's
  `latest.json`; beta lane only.
- [x] 2.6 Update the workflow header comment to describe both lanes.

## 3. Channel-aware update check (Rust)

- [x] 3.1 Add the `semver` dependency to `src-tauri/Cargo.toml`.
- [x] 3.2 New `src-tauri/src/updates.rs`: read the updater endpoints from the
  app config (`plugins.updater.endpoints`), with a pure `endpoints_for_channel`
  helper mapping `stable`/`beta` to the endpoint list to query.
- [x] 3.3 Pure `pick_higher` helper choosing between two candidate versions, with
  unit tests for the beta-wins / stable-wins / one-sided / neither cases.
- [x] 3.4 `updater_check(webview, channel)` command: build via
  `updater_builder().endpoints(..)`, run one check per endpoint for the channel,
  keep the highest candidate, drop the loser's resource, and return the plugin's
  `Metadata` shape (rid registered in the **webview's** resource table).
- [x] 3.5 Register the command in `src-tauri/src/lib.rs`.
- [x] 3.6 `cargo test` and `cargo check` pass.

## 4. Release-channel preference (frontend, TDD)

- [x] 4.1 New `src/lib/settings/releaseChannel.svelte.ts` following
  `compactMode.svelte.ts`: `CHANNELS`, `ReleaseChannelPrefs`, a pure
  `parseReleaseChannelPrefs` defaulting to `stable`, and a rune store with
  `load()` / `setChannel()` saving the merged `releaseChannel` slice.
- [x] 4.2 `releaseChannel.test.ts` covering the default, the malformed-slice
  fallback, and a round-trip through the store.
- [x] 4.3 Load the store on app startup alongside the other settings stores.

## 5. Wire the check to the channel (frontend, TDD)

- [x] 5.1 New `src/lib/updates/channelCheck.ts`: invoke `updater_check` and
  reconstruct the plugin `Update` from the returned metadata; `null` when there
  is no candidate.
- [x] 5.2 `runUpdateCheck` reads the channel from the store and calls
  `channelCheck` instead of the plugin's `check()`; signatures of
  `runUpdateCheck` / `checkForUpdateOnLaunch` / `startUpdatePolling` unchanged.
- [x] 5.3 Update `checkForUpdate.test.ts` to mock the new seam, and add cases for
  the launch check following a stored `beta` channel.

## 6. Settings UI

- [x] 6.1 Add a "Release channel" row to the *Software update* section of
  `SettingsModal.svelte`, using the existing `Dropdown`, with a short
  description of what beta means.
- [x] 6.2 On change, persist and immediately run an update check for the new
  channel.

## 7. Config, docs, verification

- [x] 7.1 Add the beta endpoint to `src-tauri/tauri.conf.json` as
  `plugins.updater.endpoints[1]` (stable stays index 0).
- [x] 7.2 README "Releases": document the two lanes, the prerelease version
  scheme, the `beta-channel` pinned release, and how a maintainer cuts a beta.
- [x] 7.3 `yarn check:gate` passes (svelte-check, vitest, coverage, storage lint,
  install tests).
- [x] 7.4 `openspec validate add-beta-release-channel --strict` passes.

## 8. Cut the first beta

- [ ] 8.1 Land the change on `main`.
- [ ] 8.2 Create the `beta` branch at `main`'s HEAD.
- [ ] 8.3 Bump `package.json` to `0.4.0-beta.1` on `beta` and write its
  `CHANGELOG.md` section (the pipeline hard-fails without one).
- [ ] 8.4 Push `beta`; confirm the run gates, builds all four targets, publishes
  a prerelease, and refreshes `beta-channel`.
- [ ] 8.5 **Manual, not verifiable in-session:** install the beta build, switch a
  stable install to the beta channel, and confirm it picks the prerelease up.
