## Why

Agent Desktop ships one release train. Every push to `main` that bumps
`package.json` past the highest `v*` tag builds four installers, publishes a
GitHub Release, and every installed app picks it up from
`releases/latest/download/latest.json` within the hour. There is no way to put a
build in front of willing testers before it reaches everyone, and no way for a
user to opt into that risk.

A beta channel needs three things that do not exist today:

1. **A second release lane.** The pipeline is hardwired to `main`
   (`on: push: branches: [main]`, `git push origin HEAD:main`,
   `prerelease: false`), and `scripts/release-gate.sh` is prerelease-blind: its
   `semver_cmp` does `${1%%[-+]*}`, so `0.4.0-beta.2` and `0.4.0-beta.1` compare
   *equal* and the beta lane could never ship twice. Worse, `LATEST_TAG` scans
   **all** `v*` tags, so once a single `v0.4.0-beta.1` tag exists, a stable bump
   to `0.4.0` would also compare equal and the **existing stable lane would
   silently stop releasing**.
2. **A channel-aware update check.** The Tauri updater takes its endpoints from
   `tauri.conf.json` and, given several, uses the **first that responds** — not
   the one with the highest version. Neither the JS `check()` options nor the
   plugin's `Builder` expose a runtime endpoint override, so channel selection
   cannot be expressed in configuration at all.
3. **A user-visible switch**, so opting in and out is a choice rather than a
   reinstall.

## What Changes

- **NEW: a `beta` release channel.** `beta` becomes a release branch alongside
  `main`. A push to it releases when `package.json` carries a **prerelease**
  version (`0.4.0-beta.1`), producing the same four signed installers and a
  GitHub Release marked `prerelease: true` — which keeps it out of
  `releases/latest`, so stable users are untouched.
- **Channel-partitioned release gate.** `scripts/release-gate.sh` delegates its
  version math to a new, unit-tested `scripts/lib/version-compare.mjs` with a
  full semver comparator (prerelease-aware). Tag space is partitioned by channel:
  the stable lane considers only suffix-free `vX.Y.Z` tags and refuses a
  prerelease version; the beta lane requires a prerelease version and must exceed
  **both** the highest beta tag and the highest stable tag. This repairs the
  existing stable lane as a precondition of adding the second one.
- **A stable URL for the beta manifest.** GitHub has no "latest prerelease"
  download URL, so after a beta release publishes, the pipeline **deletes and
  recreates** a pinned `beta-channel` prerelease holding that release's
  `latest.json`. Delete-and-recreate (rather than replacing an asset in place)
  gives a fresh asset URL with no CDN staleness, and it runs only after all four
  build legs have finished — the same reason the real tag is created last.
- **NEW: a channel-aware update check, resolved at runtime in Rust.** A new
  `updater_check` command builds the updater with
  `updater_builder().endpoints(…)` per channel and returns the plugin's own
  `Metadata` shape, so the JS side reconstructs a plugin `Update` and the
  existing `download` / `install` / progress path is untouched.
- **Highest version wins on beta, decided by the client.** On the beta channel
  the command checks **both** manifests and keeps the higher semver candidate
  (closing the loser's resource handle). A stable hotfix that outranks the
  current beta therefore reaches beta users, without the publish pipeline having
  to maintain any cross-channel manifest invariant.
- **NEW: a release-channel switch at the bottom of Settings**, in the existing
  *Software update* section next to the version and "Check for updates". The
  choice is a durable `releaseChannel` slice of `settings.json` (default
  `stable`), and switching re-checks immediately rather than waiting for the
  hourly poll.

## Assumptions

- **"Only stable versions count" on the stable channel means candidate
  selection, not rollback.** A user sitting on `0.4.0-beta.3` who switches back
  to `stable` sees no update until a stable release exceeds `0.4.0-beta.3`. The
  updater's default comparator never downgrades, and this change deliberately
  does not add a downgrade path.
- **Beta versions are semver prereleases of the next stable version**
  (`0.4.0-beta.1` precedes `0.4.0`). This is what makes "highest wins" a single
  semver comparison across both channels, and it is also why the version must
  carry the suffix everywhere — the updater compares a manifest against the
  app's own compiled version, so `package.json`, `tauri.conf.json`, `Cargo.toml`
  and the tag must all agree.
- **Windows MSI ProductVersion cannot express a prerelease** (it is
  `major.minor.patch` only), so two betas of the same base version share an MSI
  ProductVersion. This does not affect in-app updating: Tauri's Windows updater
  uses the NSIS installer, which overwrites rather than relying on an MSI upgrade
  code. Recorded as a known limitation, not fixed here.

## Capabilities

### New Capabilities
- `release-channels`: the user chooses which release train the app follows
  (`stable` or `beta`); the choice is durable, exposed in Settings, and decides
  which update manifest(s) an update check considers.

### Modified Capabilities
- `desktop-auto-update`: the update check resolves its endpoint from the selected
  channel at runtime instead of using a single fixed configured endpoint, and on
  the beta channel picks the highest-versioned candidate across both manifests.
- `release-pipeline`: gains a second release lane on the `beta` branch with
  prerelease versions, prerelease-aware and channel-partitioned gating, GitHub
  Releases marked as prereleases, and a pinned `beta-channel` release that serves
  the beta update manifest at a stable URL.

## Impact

- **Dependencies:** add `semver` (Rust, already present transitively via
  `tauri-plugin-updater`). No new JS dependencies.
- **Backend:** new `src-tauri/src/updates.rs` (`updater_check` command +
  endpoint + candidate-selection helpers), registered in `src-tauri/src/lib.rs`.
- **Frontend:** new `src/lib/settings/releaseChannel.svelte.ts`, new
  `src/lib/updates/channelCheck.ts`; `src/lib/updates/checkForUpdate.ts` switches
  to the channel-aware check; `src/lib/ui/SettingsModal.svelte` gains the
  selector row.
- **Config:** `src-tauri/tauri.conf.json` gains the beta endpoint as
  `plugins.updater.endpoints[1]` (index 0 stays the stable endpoint).
- **CI:** `.github/workflows/release.yml` — `beta` added to the push trigger, a
  channel output on the gate, branch-correct push, `prerelease` on the created
  Release, and a `beta-channel` refresh step in `publish-release`.
- **Scripts:** `scripts/release-gate.sh` rewritten around the new
  `scripts/lib/version-compare.mjs`; both covered by
  `scripts/lib/version-compare.test.ts`.
- **Docs:** README "Releases" gains the two-lane model; `CHANGELOG.md` gains a
  section for the first beta version (the pipeline hard-fails without one).
- **Not verifiable in-session:** the actual GitHub Actions run, the signed
  artifacts, and the end-to-end in-app update between channels need a real
  release. The pure seams (version math, channel partitioning, candidate
  selection, pref parsing) are unit-tested headlessly.
