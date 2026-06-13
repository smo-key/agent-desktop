## 1. Cross-platform sidecar provisioning

- [x] 1.1 Refactor `scripts/fetch-whisper.sh` to derive target triple + cmake arch from the host (`uname`), with `TARGET_TRIPLE`/`TARGET_ARCH` env override; default `aarch64-apple-darwin`. Keep idempotency + placeholder handling.
- [x] 1.2 Refactor `scripts/fetch-llama.sh` the same way (host detection + override + default arm64).
- [x] 1.3 Make both scripts emit the binary named `<name>-<triple>` and append `.exe` on Windows; on Windows drive cmake with the MSVC/Visual Studio generator (runnable under Git Bash). On Linux build with the system gcc/clang toolchain for the host arch.
- [x] 1.4 Confirm `scripts/fetch-models.sh` works on macOS, Linux, and Windows (Git Bash) — adjust curl/wget usage if needed so `ggml-tiny.bin` provisions everywhere.
- [x] 1.5 Add a sidecar validation helper (script or workflow step) that checks each provisioned sidecar is an executable of the expected binary format + arch for the target, failing fast on mismatch/missing.
- [x] 1.6 Update `src-tauri/binaries/README.md` (and `models/README.md` if present) to document the cross-platform provisioning + override env.

## 2. Changelog tooling

- [x] 2.1 Add a pinned `git-cliff` config `cliff.toml` at the repo root using the conventional-commits preset, grouping Features/Fixes/Docs/Chore/etc.
- [x] 2.2 Generate an initial `CHANGELOG.md` from existing history so the file exists before the first automated release.
- [x] 2.3 Verify locally that `git-cliff` produces (a) a since-last-tag release-notes snippet and (b) the full `CHANGELOG.md`, both from the same commit range.

## 3. Auto-update integration

- [ ] 3.1 Add `@tauri-apps/plugin-updater` (JS) and `tauri-plugin-updater` (Rust) deps; register the plugin in `src-tauri/src` and the JS entry.
- [ ] 3.2 Generate an updater signing keypair (`tauri signer generate`); commit the public key into `tauri.conf.json` `plugins.updater` with the GitHub Release `latest.json` endpoint. Document storing the private key as a secret.
- [ ] 3.3 Add a minimal in-app update-check flow: on launch, check for an update; if found, prompt and on confirm download/verify/install; on no-update or failure (offline) continue silently without blocking startup.
- [ ] 3.4 Add capability/permission entries the updater plugin requires (`capabilities/default.json`) and ensure `check:gate` still passes.

## 4. Version sync + tagging

- [ ] 4.1 Add a script/step that reads `package.json` version and writes it into `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `Cargo.lock` (e.g. `cargo update -p agent-desktop --precise <v>`).
- [ ] 4.2 Add gate logic that compares `package.json` version to the latest `v*` tag and outputs `should_release` + the version, and refuses if `v<version>` already exists.

## 5. Release workflow

- [ ] 5.1 Create `.github/workflows/release.yml` triggered on `push: main` and `workflow_dispatch` (with a publish/no-publish input), with `permissions: contents: write`.
- [ ] 5.2 Implement the `gate` job: run version-bump detection (4.2); when releasing, run version sync (4.1) + `CHANGELOG.md` regen (2.x), commit `chore(release): v<version> [skip ci]` to `main`, create + push annotated tag `v<version>`.
- [ ] 5.3 Implement the build matrix (`fail-fast: false`) over the five targets with correct runners (`macos-14`, `macos-13`, `windows-latest`, `ubuntu-22.04`, `ubuntu-22.04-arm`); set up Node, Rust (target triple), and on Linux install the Tauri system deps (webkit2gtk, gtk, librsvg, appindicator, patchelf, cmake/build-essential).
- [ ] 5.4 Add Cargo + sidecar caching keyed on `Cargo.lock` + target triple + pinned whisper/llama tags.
- [ ] 5.5 In each build job: provision sidecars (section 1) + model, run `npm run check:gate`, then build/bundle via `tauri-action` (or Tauri CLI) producing the platform installers + signed updater bundles.
- [ ] 5.6 Wire macOS signing/notarization: import `.p12` from `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD` into a temporary keychain, export `APPLE_SIGNING_IDENTITY` + a notary credential set; skip + warn (unsigned) when the cert secret is absent.
- [ ] 5.7 Pass `TAURI_SIGNING_PRIVATE_KEY` (+ password) so update bundles are signed.
- [ ] 5.8 Publish a single GitHub Release `v<version>` with git-cliff release notes as the body and all targets' installers + `latest.json` attached.

## 6. Secrets, docs, and verification

- [ ] 6.1 Document all required repo secrets and the version-bump release flow in `README.md` and extend `.env.notarize.example` with `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD` and the `TAURI_SIGNING_PRIVATE_KEY` notes.
- [ ] 6.2 Validate the workflow YAML (`actionlint` or equivalent) and dry-run the gate logic (version compare, sync, skip-ci guard) locally where possible.
- [ ] 6.3 Confirm idempotency: re-running on an unchanged version and on an existing tag produces no new release; the `[skip ci]` sync commit does not start a release loop.
- [ ] 6.4 Resolve the open questions from `design.md` with the maintainer (branch-protection token for write-back; arm64 Linux runner availability) and adjust the matrix/token config accordingly.
