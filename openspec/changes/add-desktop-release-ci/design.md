## Context

Agent Desktop is a Tauri 2 app (Rust + SvelteKit). Today the only path to a
distributable is a developer running `npm run package:mac:signed` locally on
Apple Silicon. The version string lives in three files (`package.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, plus `Cargo.lock`), the
three voice sidecars (`whisper-cli`, `whisper-server`, `llama-server`) and the
bundled `ggml-tiny.bin` model are provisioned from source by macOS-arm64-only
bash scripts, and signing/notarization is already env-var driven (CI-ready) via
`scripts/package-mac-signed.sh`. There are no git tags, no `CHANGELOG.md`, and no
`.github/` directory. The repo uses conventional commits.

This design covers a GitHub Actions pipeline that releases on version bump,
across five OS/arch targets, signed + notarized where applicable, with a
conventional-commit changelog and in-app auto-update.

## Goals / Non-Goals

**Goals:**
- One automated path from "bump `package.json` version on `main`" to a published,
  multi-platform GitHub Release.
- `package.json` is the single source of version truth; the other manifests are
  derived by CI.
- Real, voice-capable builds on all five targets (sidecars built per OS/arch).
- Signed + notarized macOS builds from CI secrets, with a graceful unsigned
  fallback so forks/PRs still build.
- Grouped release notes + maintained `CHANGELOG.md` from conventional commits.
- In-app update check backed by signed updater artifacts.

**Non-Goals:**
- Releasing on every commit (only on a version increase).
- A rich in-app update UI (a minimal check-on-launch + install prompt is enough).
- App Store / Microsoft Store / Linux package-repo distribution (GitHub Release
  downloads only).
- Windows/Linux code signing (out of scope; only macOS is signed/notarized here).
- Changing how runtime-downloaded models (small/large/polish LLM) work.

## Decisions

### 1. Trigger & version-bump detection
The workflow runs on `push` to `main` and on `workflow_dispatch`. A `gate` job
reads `version` from `package.json` at the pushed commit and compares it against
the highest existing `v*` tag (via `git describe --tags`/`gh release list`). It
proceeds **only if** the package version is strictly greater and no `v<version>`
tag exists yet. This makes the pipeline idempotent: a re-run, or the
version-sync commit itself, will not re-release. `workflow_dispatch` can force a
build for testing without publishing (an input flag controls publish).

*Alternatives considered:* tag-push trigger (`on: push: tags: v*`) — rejected
because the user wants the act of bumping `package.json` on `main` to be the
trigger, not a separate manual tag. Release-please-style PR bot — heavier than
needed and changes the team's commit flow.

### 2. Version single-sourcing & write-back
On a release run, the `gate` job rewrites the version in
`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, runs `cargo update -p
agent-desktop --precise <version>` (or edits `Cargo.lock`'s package entry) to
keep the lock in sync, commits with message `chore(release): v<version> [skip
ci]`, and pushes to `main`, then creates and pushes an annotated tag
`v<version>` on that commit. `[skip ci]` plus the idempotency guard prevents a
release loop. This requires a token with write access to a protected `main`
(`permissions: contents: write` for the default `GITHUB_TOKEN`, or a PAT/deploy
key if branch protection blocks the default token).

*Alternatives considered:* requiring the developer to keep all three files in
sync and only verifying (the first option offered to the user) — rejected per
the user's choice for CI auto-sync. Building straight from the pushed commit
without a tag — rejected because the GitHub Release and updater endpoint key off
`v<version>`.

### 3. Build matrix (five native runners)
| Target triple | Runner | Bundles |
|---|---|---|
| `aarch64-apple-darwin` | `macos-14` | `.dmg`, `.app`, updater `.app.tar.gz` |
| `x86_64-apple-darwin` | `macos-13` | `.dmg`, `.app`, updater `.app.tar.gz` |
| `x86_64-pc-windows-msvc` | `windows-latest` | `.msi`, NSIS `.exe`, updater `.nsis.zip` |
| `x86_64-unknown-linux-gnu` | `ubuntu-22.04` | `.deb`, AppImage, updater `.AppImage.tar.gz` |
| `aarch64-unknown-linux-gnu` | `ubuntu-22.04-arm` | `.deb`, AppImage, updater `.AppImage.tar.gz` |

Each runner builds **natively** (no cross-compilation) so the sidecars and the
app share one toolchain. Linux runners install the Tauri system deps
(`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`,
`libayatana-appindicator3-dev`, `patchelf`, plus `cmake`/`build-essential` for
the sidecars). We use the official `tauri-apps/tauri-action` to build, bundle,
and upload artifacts where convenient, but invoke our own sidecar-provisioning
step in `beforeBuild`.

*Alternatives considered:* a macOS universal binary via `--target
universal-apple-darwin` — rejected because it requires `lipo`-merging universal
sidecars, more complex than two native runners. Cross-compiling Linux arm64 from
x86_64 — rejected in favor of native arm64 runners (now GA) to avoid sysroot and
sidecar cross-build pain.

### 4. Cross-platform sidecar provisioning ("Windows with WSL" wrinkle)
The three `fetch-*.sh` scripts are refactored to derive the **target triple and
cmake arch from the host** (overridable via a `TARGET_TRIPLE`/`TARGET_ARCH`
env), defaulting to `aarch64-apple-darwin` so local Apple-Silicon dev is
unchanged. Each runner builds its own-arch `whisper-cli`, `whisper-server`,
`llama-server` from source and names them `<name>-<triple>` (Tauri appends
`.exe` on Windows automatically).

**Key correction to "build Windows with WSL":** a *native* Windows
`whisper-cli.exe`/`llama-server.exe` must be compiled with the MSVC toolchain;
compiling inside WSL produces Linux ELF binaries, which cannot be a Windows
sidecar. So on the Windows runner we run the bash provisioning script under **Git
Bash** (preinstalled on `windows-latest`) and drive **cmake with the Visual
Studio / MSVC generator** to emit native `.exe`s. WSL is therefore not used to
compile the Windows sidecars; the bash scripts are kept cross-shell instead.
This is flagged as an open question for the user in case they specifically want a
Linux-in-WSL distribution instead of a native Windows app (we are building both
a native Windows installer and a native Linux bundle, so WSL users are already
covered by the Linux artifact).

*Alternatives considered:* downloading prebuilt whisper/llama release assets per
platform — rejected for the same reason the existing scripts build from source
(upstream assets are inconsistent across versions); building from a pinned tag is
reproducible.

### 5. macOS signing, notarization & graceful fallback
A pre-build step imports the base64-decoded `.p12` into a temporary keychain
(`APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD`), unlocks it, and exports the
notary credentials Tauri reads (`APPLE_SIGNING_IDENTITY` + an API-key set or
Apple-ID set, per `.env.notarize.example`). When `APPLE_CERTIFICATE` is empty
(forks, untrusted PRs), the macOS job skips the keychain import and builds
unsigned, emitting a warning — the matrix entry still succeeds. We reuse the
existing `scripts/package-mac-signed.sh` logic conceptually but drive it through
`tauri-action` env so the same secrets flow works.

### 6. Changelog via git-cliff
A pinned `git-cliff` with a committed `cliff.toml` (conventional-commits preset,
grouped Features/Fixes/Docs/etc.) generates: (a) the release-notes body for the
GitHub Release (commits since the previous tag), and (b) the full `CHANGELOG.md`,
which CI regenerates and includes in the same `chore(release)` sync commit.

*Alternatives considered:* GitHub auto-generated notes — rejected by the user in
favor of grouped conventional-commit notes.

### 7. Auto-update
Add `@tauri-apps/plugin-updater` (JS) + `tauri-plugin-updater` (Rust) and
configure `plugins.updater` in `tauri.conf.json` with the GitHub Release
`latest.json` endpoint and the public key. CI signs the update bundles with
`TAURI_SIGNING_PRIVATE_KEY` (+ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), and
publishes `latest.json` alongside the platform bundles. The app gains a minimal
flow: on launch, check for an update; if one exists, prompt the user and install
on confirmation. The keypair is generated once (`tauri signer generate`) and the
private key stored as a secret; the public key is committed in `tauri.conf.json`.

### 8. Quality gate & caching
Before packaging, each runner runs `npm run check:gate` (svelte-check + vitest +
scenario coverage). We cache `~/.cargo`, `src-tauri/target` (keyed on
`Cargo.lock` + target triple), and the built `src-tauri/binaries/*` sidecars
(keyed on the pinned whisper/llama tags + triple) so the expensive
build-from-source only reruns when the pin or toolchain changes.

## Risks / Trade-offs

- **Write-back to a protected `main`** → the default `GITHUB_TOKEN` may be blocked
  by branch protection; mitigation: document using a PAT/deploy key or a
  protection exception for the release bot, and make the sync commit idempotent.
- **Release loop from the sync commit** → mitigated by `[skip ci]` *and* the
  tag-existence/version-greater idempotency guard (belt and suspenders).
- **Slow first builds** (whisper + llama from source on five runners) →
  mitigated by caching keyed on the pinned tags; first run is slow, steady state
  is fast. CI minutes on macOS/arm runners cost more — accepted.
- **Sidecar build breakage on a new OS** (MSVC quirks, Linux arm64) → highest on
  Windows/Linux where these have never been built; mitigation: pin upstream tags,
  validate each target's sidecars are Mach-O/PE/ELF for the right arch before
  bundling, and allow `fail-fast: false` so one target's failure doesn't sink the
  others.
- **Notarization flakiness/timeouts** → Apple's notary service can be slow;
  accepted, with a clear unsigned fallback for non-secret contexts.
- **Updater signing-key loss** → if the private key is lost, existing installs
  can't verify updates; mitigation: document secure storage/backup of the
  generated key out-of-band.
- **arm64 Linux runner availability** → if the hosted `ubuntu-22.04-arm` runner is
  unavailable in this repo's plan, that matrix leg must fall back to QEMU/cross or
  be dropped; flagged as an open question.

## Open Questions

- Does branch protection on `main` permit the release bot to push the version-sync
  commit + tag with the default `GITHUB_TOKEN`, or is a PAT/deploy key needed?
- Are hosted arm64 Linux runners available on this repo's GitHub plan? If not,
  drop Linux arm64 or cross-compile.
- "Windows with WSL": confirmed interpretation is a **native** Windows installer
  (plus a native Linux bundle that also serves WSL users); the Windows sidecars
  are MSVC-built, not WSL/Linux binaries. Flag if a Linux-only-via-WSL story was
  intended instead.
