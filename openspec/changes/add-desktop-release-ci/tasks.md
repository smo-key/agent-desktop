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

- [x] 3.1 Add `@tauri-apps/plugin-updater` (JS) and `tauri-plugin-updater` (Rust) deps; register the plugin in `src-tauri/src` and the JS entry.
- [x] 3.2 Generate an updater signing keypair (`tauri signer generate`); commit the public key into `tauri.conf.json` `plugins.updater` with the GitHub Release `latest.json` endpoint. Document storing the private key as a secret.
- [x] 3.3 Add a minimal in-app update-check flow: on launch, check for an update; if found, prompt and on confirm download/verify/install; on no-update or failure (offline) continue silently without blocking startup.
- [x] 3.4 Add capability/permission entries the updater plugin requires (`capabilities/default.json`) and ensure `check:gate` still passes.

## 4. Version sync + tagging

- [x] 4.1 Add a script/step that reads `package.json` version and writes it into `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `Cargo.lock` (e.g. `cargo update -p agent-desktop --precise <v>`). (`scripts/sync-version.sh`)
- [x] 4.2 Add gate logic that compares `package.json` version to the latest `v*` tag and outputs `should_release` + the version, and refuses if `v<version>` already exists. (`scripts/release-gate.sh`)

## 5. Release workflow

- [x] 5.1 Create `.github/workflows/release.yml` triggered on `push: main` and `workflow_dispatch` (with a publish/no-publish input), with `permissions: contents: write`.
- [x] 5.2 Implement the `gate` job: run version-bump detection (4.2); when releasing, run version sync (4.1) + `CHANGELOG.md` regen (2.x), commit `chore(release): v<version> [skip ci]` to `main`, create + push annotated tag `v<version>`. (Includes a `[skip ci]` head-commit guard so the sync commit cannot loop; a hand-authored `chore(release):` commit without `[skip ci]` is allowed to drive a release, with the tag-idempotency check in `release-gate.sh` as the loop backstop.)
- [x] 5.3 Implement the build matrix (`fail-fast: false`) over the four targets with correct runners (`macos-14`, `windows-2022`, `ubuntu-22.04`, `ubuntu-22.04-arm`); set up Node, Rust (target triple), and on Linux install the Tauri system deps (webkit2gtk, gtk, librsvg, appindicator, patchelf, cmake/build-essential).
- [x] 5.4 Add Cargo + sidecar caching keyed on `Cargo.lock` + target triple + pinned whisper/llama tags.
- [x] 5.5 In each build job: provision sidecars (section 1) + model, run `yarn check:gate`, then build/bundle via `tauri-action` (or Tauri CLI) producing the platform installers. (Updater-bundle signing env is wired forward-compatibly; actual signed update bundles emit once the updater plugin is configured in task 3.x.)
- [x] 5.6 Wire macOS signing/notarization: import `.p12` from `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD` into a temporary keychain, export `APPLE_SIGNING_IDENTITY` + a notary credential set; skip + warn (unsigned) when the cert secret is absent. (tauri-action performs the temp-keychain import from the cert env; a step warns when `APPLE_CERTIFICATE` is empty.)
- [x] 5.7 Pass `TAURI_SIGNING_PRIVATE_KEY` (+ password) so update bundles are signed. (Env passed to tauri-action; effective once the updater plugin from task 3.x lands.)
- [x] 5.8 Publish a single GitHub Release `v<version>` with git-cliff release notes as the body and all targets' installers attached. (`latest.json`/updater artifacts attach once the updater plugin from task 3.x is configured.)
- [x] 5.9 Install JS deps with Yarn (Classic): build job runs `yarn install --frozen-lockfile` (not `npm ci`) against a committed `yarn.lock`, with `actions/setup-node` `cache: yarn`. Repo standardizes on Yarn (`package.json` scripts, `.githooks/pre-commit`, README); `package-lock.json` removed.
- [x] 5.10 Fix the Windows `Provision sidecars + model` leg: `llama.cpp@b4000`'s `common/{log,common}.cpp` use `std::chrono::system_clock` without `#include <chrono>`, which VS 2022's newer MSVC STL no longer provides transitively (C2039). `scripts/fetch-llama.sh` patches the include IN-SOURCE (idempotently, after clone) into those two `.cpp` files. A force-include compiler flag was rejected: the VS generator applies `CMAKE_CXX_FLAGS` project-wide, so `/FI chrono` leaks onto ggml's **C** translation units → STL1003 (C++ header in a C compile); and the `/FI`-slash form is additionally mangled by Git Bash MSYS2 path-conversion. Editing only `.cpp` sources avoids both traps and is harmless on Linux/macOS.
- [x] 5.13 Make the Windows leg best-effort and unblock publishing: the Windows native build does not yet compile (`src-tauri` events.rs/orchestration.rs use Unix-domain sockets, absent on Windows → E0433). Mark only the Windows matrix leg `continue-on-error: ${{ contains(matrix.triple, 'windows') }}` so a Windows failure no longer fails the `build` job, letting `publish-release` undraft the release once macOS + Linux succeed. macOS/Linux remain required (a failure keeps the release a draft). Follow-up: port the IPC to named pipes to restore the Windows installer.
- [x] 5.12 Fix the Windows sidecar-format validation (`scripts/lib/target-triple.sh` `EXPECT_RE`): the Windows runner's `file` prints `PE32+ executable for MS Windows 6.00 (console), x86-64, ...` — "MS Windows" BEFORE the arch — but the regex required `x86-64` before `Windows` (`PE32\+.*(x86-64|x86_64).*Windows`), so valid `.exe`s (whisper + llama) all failed validation. Drop the order-dependent `.*Windows` (PE32+ already implies a Windows PE) and keep `PE32\+.*(x86-64|x86_64)`, which still rejects 32-bit/ARM64 PEs. Verified against the real output and adversarial arches.
- [x] 5.11 Make macOS signing a true graceful fallback for an absent OR present-but-unimportable cert (corrupt `.p12`/base64 or wrong password). Root cause: `tauri-bundler` keys off the *presence* of `APPLE_CERTIFICATE`, and a GitHub `env:` value of `''` (what `${{ secrets.X }}` yields when unset) is present-but-empty (`var_os` → `Some("")`), so it ran `security import` on an empty cert and hard-failed the leg. Fix: a `Preflight macOS signing` step runs the real `security import` into a throwaway keychain and exports the non-empty signing+notary vars to `$GITHUB_ENV` ONLY on success; the build step lists none of them, so on failure they stay truly unset and `tauri build` produces a clean UNSIGNED bundle with a warning. Removed the job-level `APPLE_CERTIFICATE` env (it re-introduced the empty var into every step). Self-heals to signed once the secrets are fixed.

## 6. Secrets, docs, and verification

- [x] 6.1 Document all required repo secrets and the version-bump release flow in `README.md` (including `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD` and the `TAURI_SIGNING_PRIVATE_KEY` notes). Signing/notarization is CI-only — there is no local signed-build script or `.env.notarize.example`.
- [x] 6.2 Validate the workflow YAML (`actionlint` or equivalent) and dry-run the gate logic (version compare, sync, skip-ci guard) locally where possible.
- [x] 6.3 Confirm idempotency: re-running on an unchanged version and on an existing tag produces no new release; the `[skip ci]` sync commit does not start a release loop.
- [ ] 6.4 Resolve the open questions from `design.md` with the maintainer (branch-protection token for write-back; arm64 Linux runner availability) and adjust the matrix/token config accordingly.
