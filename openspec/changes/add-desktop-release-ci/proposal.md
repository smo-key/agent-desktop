## Why

Agent Desktop has no CI/CD: every release is a manual `npm run package:mac:signed`
on one developer's Apple Silicon machine, producing a single unsigned-by-default
artifact for one architecture, with no published GitHub Release, no changelog, and
no way for users to get or update the app. We want a push-button (in fact,
push-to-`main`) pipeline that builds the latest version for every supported
platform, signs it, publishes a GitHub Release with grouped release notes, and
lets the app update itself.

## What Changes

- **Release on version bump.** A GitHub Actions workflow runs on every push to
  `main`. When `package.json`'s `version` has increased relative to the latest
  `v*` release tag, it releases that version; otherwise it does nothing. A manual
  `workflow_dispatch` entry point is also provided.
- **Version is single-sourced from `package.json`.** On a release run, CI syncs
  the new version into `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and
  `Cargo.lock`, commits the sync back to `main` (with `[skip ci]`), and creates +
  pushes an annotated tag `v<version>` on that commit. Re-running never
  re-releases an existing tag (idempotent).
- **Five-target build matrix.** Each release builds, on its native runner:
  macOS arm64 (`aarch64-apple-darwin`), macOS Intel (`x86_64-apple-darwin`),
  Windows x86_64 (`x86_64-pc-windows-msvc`), Linux x86_64
  (`x86_64-unknown-linux-gnu`), and Linux arm64 (`aarch64-unknown-linux-gnu`).
- **Cross-platform sidecar provisioning.** The `fetch-whisper.sh`,
  `fetch-llama.sh`, and `fetch-models.sh` scripts gain host-OS/arch detection so
  each runner natively builds `whisper-cli`, `whisper-server`, and `llama-server`
  for its own target triple (with the correctly-suffixed sidecar filename and the
  matching toolchain). Apple Silicon stays the default for local developers.
- **Code signing + notarization.** macOS builds are signed and notarized via
  repo secrets (cert import into a temporary keychain + notary credentials).
  When signing secrets are absent (forks, PRs), the build degrades to an unsigned
  artifact with a warning rather than failing.
- **Conventional-commit changelog.** `git-cliff` (pinned, with a committed
  `cliff.toml`) generates grouped release notes (Features / Fixes / etc.) from the
  conventional commits since the previous tag. CI maintains a committed
  `CHANGELOG.md` and uses the same notes as the GitHub Release body.
- **One GitHub Release per version**, with all five platforms' installers
  (`.dmg`, `.msi`/NSIS `.exe`, `.deb`/AppImage) attached.
- **In-app auto-update.** Adds the Tauri updater plugin and an update-signing
  keypair (in secrets); CI emits and attaches the signed update bundles +
  `latest.json`, and the app gains a minimal "check for updates on launch, prompt
  to install" flow.
- **Quality gate + caching.** Each build runs the existing `check:gate`
  (svelte-check + vitest + scenario coverage) before packaging, and caches Cargo
  and the built sidecars to keep build times reasonable.

## Capabilities

### New Capabilities
- `release-pipeline`: The GitHub Actions release workflow — push-to-`main`
  trigger, version-bump detection, version sync + annotated tagging, the
  five-target build matrix, the pre-package quality gate and caching, and
  publishing a single GitHub Release with all platform artifacts attached.
- `release-signing`: macOS code-signing + notarization in CI (keychain import
  from secrets, notary credentials, graceful unsigned fallback) and the
  updater-bundle signing keypair.
- `release-changelog`: Conventional-commit changelog generation with `git-cliff`
  — `cliff.toml` config, the maintained `CHANGELOG.md`, and the release-notes body.
- `cross-platform-sidecars`: Host-OS/arch-aware provisioning of the
  `whisper-cli` / `whisper-server` / `llama-server` sidecars and the bundled
  model for every supported target triple.
- `desktop-auto-update`: The Tauri updater plugin configuration, the published
  `latest.json` + signed update artifacts, and the in-app update-check flow.

### Modified Capabilities
<!-- None: no existing spec governs release/CI behavior or the sidecar scripts. -->

## Impact

- **New files**: `.github/workflows/release.yml` (and possibly a reusable
  `build` workflow), `cliff.toml`, `CHANGELOG.md`, per-OS sidecar provisioning
  (extended `scripts/fetch-*.sh` and/or new Windows/Linux equivalents).
- **Modified**: `scripts/fetch-whisper.sh`, `scripts/fetch-llama.sh`,
  `scripts/fetch-models.sh` (host detection); `src-tauri/tauri.conf.json`
  (updater plugin config, bundle targets per OS); `src-tauri/Cargo.toml` +
  `package.json` (updater plugin deps); app source (minimal update-check flow);
  `README.md` (document new secrets — signing/notarization is CI-only, with no
  local signed-build path).
- **GitHub repo configuration (manual, out-of-band)**: signing/notary secrets,
  the updater keypair secret, and a release token (PAT or
  `permissions: contents: write`) able to push the version-sync commit + tag to a
  protected `main`.
- **New dependencies**: `@tauri-apps/plugin-updater` + `tauri-plugin-updater`,
  `git-cliff` (CI tool, pinned), `tauri-action` or the Tauri CLI in CI.
- **Build-time cost**: building whisper/llama from source on five runners is slow
  (mitigated by caching); Linux runners need the Tauri system dependencies
  (webkit2gtk, gtk, librsvg, etc.) and arm64 Linux runner availability.
