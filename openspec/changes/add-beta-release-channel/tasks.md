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

## 8. Adversarial review follow-ups

- [x] 8.1 **CRITICAL** — `updater_check` returned an error whenever ANY endpoint
  failed, not when all did. Since the plugin reports a 404 manifest as `Err` and
  the pinned `beta-channel` release does not exist until the first beta ships,
  every beta check would have reported "Couldn't check" forever. Aggregation now
  keys on how many endpoints ANSWERED, via the pure, tested `classify_empty`.
- [x] 8.2 **CRITICAL** — switching Beta → Stable left a staged prerelease whose
  "Update ready — restart" button still installed it. Added `updateStore.discard()`
  (closes the handle, invalidates any in-flight download, leaves an `installing`
  update alone) and call it from the channel switch, with tests.
- [x] 8.3 **CRITICAL** — the `beta-channel` refresh deleted the release before
  recreating it, so a failure inside the step left the endpoint permanently 404
  with no automated recovery. Now create-if-missing + `--clobber`, and the tag
  step is idempotent so "Re-run failed jobs" can recover.
- [x] 8.4 `force_publish` could override "tag already exists", pushing a pointless
  sync commit before `create-release` aborted. The gate now reports `tag_exists`
  separately and the override refuses it.
- [x] 8.5 The gate interpolated the repo path into an `import()` specifier, which
  broke on a checkout path containing `#` or `?`. Path now goes through argv +
  `pathToFileURL`; verified against a `repo#1` checkout.
- [x] 8.6 Asserted the positional channel→endpoint coupling against the real
  `tauri.conf.json`, so reordering those two URLs (which would serve the beta
  manifest to every stable user) fails a test instead of shipping.
- [x] 8.7 `releaseChannel.load()` could revert a choice made while it was in
  flight, desyncing memory from disk. Guarded and tested.
- [x] 8.8 Added the missing `channelCheck.ts` tests, and took the emitted
  version/tag from the decision so `VERSION=v1.2.3` cannot yield `tag=vv1.2.3`.

## 9. Windows MSI rejects a non-numeric prerelease identifier

Discovered by the first real beta run: `0.4.0-beta.1` built on macOS and both
Linux targets, then failed the Windows leg with *"optional pre-release identifier
in app version must be numeric-only and cannot be greater than 65535 for msi
target"* — after compiling the binary, ~12 minutes in. No tag was created and
nothing was published, so the safe failure mode held.

- [x] 9.1 Number betas `0.4.0-1`, `0.4.0-2`, … instead of `-beta.N`.
- [x] 9.2 Add `isMsiCompatibleVersion` to the gate so this fails in seconds, with
  a message naming the required form, instead of minutes into the Windows build.
- [x] 9.3 Update the proposal, design, release-pipeline and release-channels
  specs, and the README, to the numeric scheme.

## 10. Cut the first beta

- [ ] 10.1 Land the change on `main`.
- [ ] 10.2 Create the `beta` branch at `main`'s HEAD.
- [ ] 10.3 Bump `package.json` to `0.4.0-1` on `beta` and write its
  `CHANGELOG.md` section (the pipeline hard-fails without one).
- [ ] 10.4 Push `beta`; confirm the run gates, builds all four targets, publishes
  a prerelease, and refreshes `beta-channel`.
- [ ] 10.5 **Manual, not verifiable in-session:** install the beta build, switch a
  stable install to the beta channel, and confirm it picks the prerelease up.
