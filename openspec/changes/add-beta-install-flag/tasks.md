## 1. Fixtures

- [x] 1.1 Add a `releases` list fixture (`docs/tests/fixtures-releases.json`) in
  the shape GitHub's `GET /releases` returns, ordered newest-first and
  containing, in order: a **draft prerelease**, a stable release, and two
  published prereleases. The draft is the case that matters — a failed release
  run leaves one behind, and this repo had exactly that for `v0.4.0-2`.
- [x] 1.2 Add a second fixture with no prerelease at all, for the
  nothing-to-install path.

## 2. install.sh — pure logic (TDD)

- [x] 2.1 Test + implement `parse_channel`: empty → `stable`, `beta`/`BETA` →
  `beta`, `stable` → `stable`, anything else → non-zero.
- [x] 2.2 Test + implement `newest_prerelease_tag`: newest non-draft prerelease
  from a releases list, skipping drafts and stable releases; non-zero when the
  list holds none.
- [x] 2.3 Test + implement `channel_hint`: the closing guidance printed after a
  beta install, empty for stable.

## 3. install.sh — wiring

- [x] 3.1 Parse the first positional argument in `main`, rejecting an unknown
  channel before any network call.
- [x] 3.2 On beta, fetch the releases list, resolve the newest prerelease tag,
  then fetch that tag's single-release JSON and reuse `resolve_asset` unchanged.
- [x] 3.3 Print the channel being installed, and the in-app channel hint after a
  beta install.
- [x] 3.4 Update the script's own usage header.

## 4. install.ps1 — mirror

- [x] 4.1 Test + implement `Get-ChannelName` (mirrors `parse_channel`).
- [x] 4.2 Test + implement `Get-NewestPrereleaseTag` (mirrors
  `newest_prerelease_tag`), including the draft case.
- [x] 4.3 Add a `param([string]$Channel)` block and wire the same flow, keeping
  `irm … | iex` working unchanged.
- [x] 4.4 Verify all three invocation forms actually bind (`| iex`, scriptblock
  positional, scriptblock named) by running them locally under `pwsh`.

## 5. Documentation

- [x] 5.1 Document both beta commands in `README.md`, including that a beta
  install does not by itself switch the app's channel.
- [x] 5.2 Note that `beta` installs the newest beta build, and that the app's
  beta channel then prefers whichever version is highest.

## 6. Verification

- [x] 6.1 `yarn check:gate` green (it runs `test:install`).
- [x] 6.2 `pwsh -NoProfile -File docs/tests/install_ps_test.ps1` green locally —
  CI only runs it on the Windows leg.
