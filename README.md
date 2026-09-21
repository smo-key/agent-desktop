# Agent Desktop

A desktop app to manage AI coding agents — for people who run lots of agents but only want to think about one thing at a time.

## Features

- **Project workspace** — organize working folders into named, color-coded projects with per-project terminals, tasks, and git state.
- **Agent orchestration** — launch and coordinate multiple agent sessions, with an orchestrator that manages the fleet over MCP.
- **Built-in terminals** — full xterm terminals with file links, filename insertion, and a tiling layout that persists across restarts.
- **Git integration** — push, pull, and switch branches per project from context menus and the app footer.
- **Voice dictation** — dictate into any input with a floating voice panel and on-device transcription (no cloud round-trip).
- **Usage dashboard** — track activity and agent usage at a glance.

## Install

**macOS (Apple Silicon) or Linux (x86_64 / arm64)** — one command downloads the
latest signed release, verifies its checksum, and installs a ready-to-run app:

```sh
curl -fsSL https://smo-key.github.io/agent-desktop/install.sh | sh
```

It needs no extra tooling, never runs `sudo`, and is short enough to
[read first](https://smo-key.github.io/agent-desktop/install.sh) before you pipe
it into a shell.

**Windows (x64)** — the same thing from a PowerShell window:

```powershell
irm https://smo-key.github.io/agent-desktop/install.ps1 | iex
```

Windows gets its own script because stock Windows has no POSIX shell, so the
`curl | sh` line above cannot run there. It uses only what ships with Windows —
no winget, no admin rights — and is likewise short enough to
[read first](https://smo-key.github.io/agent-desktop/install.ps1). Both scripts
verify the download's sha256 against the digest GitHub publishes and refuse to
install on a mismatch.

**Intel Mac**: Coming soon

### Beta builds

Add `beta` to either command to install the newest beta instead of the latest
stable release:

```sh
curl -fsSL https://smo-key.github.io/agent-desktop/install.sh | sh -s -- beta
```

```powershell
& ([scriptblock]::Create((irm https://smo-key.github.io/agent-desktop/install.ps1))) beta
```

The Windows line wraps the script in a scriptblock because `irm … | iex` cannot
pass arguments; that is the only difference from the stable command above.

Two things worth knowing:

- **Installing a beta does not subscribe you to betas.** The release channel is
  a separate setting inside the app, under *Settings → Software update*. Choose
  **Beta** there to keep receiving them; the installer says so after it runs.
- **`beta` installs the newest beta**, even if a stable release is newer. From
  then on the app's Beta channel offers whichever version is highest, beta or
  stable, so you are never held back by staying on it.

Betas get less testing than stable releases. Switch back to Stable in the same
place at any time.

## Getting Started

Prerequisites: [Node.js](https://nodejs.org/), [Yarn](https://classic.yarnpkg.com/) (Classic / v1), and the [Rust toolchain](https://www.rust-lang.org/tools/install) (for Tauri).

```bash
# Install dependencies, git hooks, and bundled model sidecars
yarn setup

# Run the desktop app in development
yarn dev

# Build a production app bundle
yarn build
```

To run just the web frontend (without the Tauri shell), use `yarn dev:web`.

## Releases

Releases are automated by [`.github/workflows/release.yml`](.github/workflows/release.yml).
`package.json`'s `version` is the single source of truth: **bump it and push to a
release branch**, and CI does the rest.

There are two release branches, one per update channel:

| Branch | Channel | Version form | GitHub Release |
| --- | --- | --- | --- |
| `main` | `stable` (the default) | `0.4.0` | normal — becomes `releases/latest` |
| `beta` | `beta` (opt in from Settings) | `0.4.0-1` | marked **prerelease** — never `releases/latest` |

The steps below describe the stable lane; the beta lane is identical except for
the branch and the prerelease version. See **Cutting a beta** below.

The whole procedure for both lanes lives in the **`release` skill**
(`.claude/skills/release/SKILL.md`) — run `/release`, or use the **Release** task
in Agent Desktop, which just invokes it. The steps below are the summary.

1. Write the release notes: add a `## X.Y.Z — YYYY-MM-DD` section at the top of
   `CHANGELOG.md` (format in the file's header), covering everything since the
   last release on that lane.
2. Bump `version` in `package.json` (e.g. `0.1.0` → `0.1.1`) and push to `main`.
3. The workflow detects the bump (the version is higher than the latest `v*`
   tag), syncs the version into `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
   and `Cargo.lock`, extracts the `## X.Y.Z` section with
   `scripts/release-notes.mjs` (failing the release if it is missing), and
   commits the manifests back as `chore(release): vX.Y.Z [skip ci]`.
4. A native matrix (macOS arm64, Windows x86_64, Linux x86_64 + arm64) builds the
   app, provisions its own-arch sidecars, runs `check:gate`, and uploads signed
   installers to a single draft GitHub Release whose body is that CHANGELOG
   section. The app shows the same notes in a "What's new" dialog after it
   updates.
5. Only once **every** target has built does the workflow tag `vX.Y.Z` on the
   sync commit and publish the Release. The tag is created last on purpose: it
   is what marks a version as shipped, so a failed build leaves no tag behind and
   the same version is simply retried on the next push to `main` (or a manual
   run from the Actions tab). A version whose tag exists is never re-released —
   bump the version instead.

Pushing a commit that does **not** raise the version publishes nothing. You can
also trigger a manual build from the Actions tab (`workflow_dispatch`).

### Cutting a beta

1. Merge or rebase what you want to ship onto the `beta` branch.
2. Set `version` in `package.json` to a semver **prerelease** of the next stable
   version, numbered `0.4.0-1`, then `0.4.0-2`, and so on.

   The identifier must be a **single number** (not `-beta.1`). That is a hard
   constraint of the Windows MSI bundler — WiX encodes the prerelease into a
   16-bit field — and `tauri build` only discovers it ~12 minutes into the
   Windows leg, after the other three platforms have already built. The release
   gate now refuses such a version up front, in seconds, with a message saying
   exactly this.
3. Add the matching `## 0.4.0-1 — YYYY-MM-DD` section to `CHANGELOG.md`; the
   release fails without it, exactly as on the stable lane.

   Before committing any of this, prove the version is releasable:
   `DRY_RUN=1 VERSION=0.4.0-1 CHANNEL=beta ./scripts/release-gate.sh`. That is
   the same code CI runs, and its refusals name the correct form.
4. Push `beta`.

`scripts/release-gate.sh` partitions the tag space by channel, so the two lanes
never interfere:

- the **stable** lane compares only against suffix-free tags, so a live beta can
  never stall a stable release;
- a **beta** must outrank the highest tag on *either* lane, so a beta that a
  shipped stable release already supersedes is refused;
- a version whose form does not match its branch (a prerelease on `main`, a plain
  version on `beta`) releases nothing and says so.

After a beta publishes, the pipeline repoints that release's `latest.json` at
the release's own tag and commits it as `beta-latest.json` on the `beta` branch,
which raw.githubusercontent serves as the beta update endpoint. A stable release
deliberately leaves it alone.

Two constraints forced that shape, both found by shipping a real beta:

- tauri-action writes `releases/latest/download/<asset>` URLs into `latest.json`,
  which 404 for a prerelease (GitHub resolves `releases/latest` to the newest
  **stable** release). `scripts/beta-manifest.mjs` rewrites them.
- Releases in this repo are **immutable**, and a tag used by one is burned
  permanently — deleting the release and the tag does not free the name. So there
  can be no rewritable "pinned release" holding the manifest.

### Update channels in the app

Users pick their channel at the bottom of **Settings → Software update**. On
`stable` only stable releases are considered. On `beta` the app checks **both**
manifests and takes the **highest semantic version**, so a stable hotfix that
outranks the current beta still reaches beta users. Switching back to `stable`
never downgrades a running prerelease — it just stops offering new betas.

Signing and notarization happen **only in CI** — there is no local signed-build
path. Set these as repository secrets (Settings → Secrets and variables →
Actions):

- **`TAURI_SIGNING_PRIVATE_KEY`** (+ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if you
  set one) — **required.** Because in-app updates are enabled
  (`bundle.createUpdaterArtifacts`), a release build fails without it. Generate
  the keypair once with `tauri signer generate -w ~/.tauri/agent-desktop.key`,
  set the private key as this secret, and commit the public key into
  `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). Back the private key up
  out-of-band — losing it breaks updates for installed apps.
- **`APPLE_CERTIFICATE`** + **`APPLE_CERTIFICATE_PASSWORD`** — base64 of your
  exported "Developer ID Application" `.p12` (`base64 -i cert.p12 | pbcopy`) and
  the password you set when exporting it.
- **`KEYCHAIN_PASSWORD`** — any throwaway string; names the temporary CI keychain.
- **`APPLE_SIGNING_IDENTITY`** — the identity string from
  `security find-identity -v -p codesigning`.
- **One notary credential set** — either an App Store Connect API key
  (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`; create at
  appstoreconnect.apple.com → Users and Access → Integrations) **or** an Apple ID
  set (`APPLE_ID`, `APPLE_PASSWORD` app-specific password, `APPLE_TEAM_ID`).

The **Apple** secrets are optional: without them the macOS build still succeeds,
producing an **unsigned**, un-notarized app (Gatekeeper will warn on launch).
`TAURI_SIGNING_PRIVATE_KEY` is the only hard requirement — the workflow checks
for it up front and stops with a clear message if it is missing.

For a quick local (unsigned, no-updater) build, run `yarn build`, which builds
with `bundle.createUpdaterArtifacts` disabled so it needs no signing key.

## Contributing

1. [Fork this repository](https://github.com/) and clone your fork.
2. Create a branch and make your changes.
3. Run the checks before opening a PR:
   ```bash
   yarn check:gate   # type-check, tests, and coverage
   ```
4. This project tracks behavior in [OpenSpec](openspec/) — when you change requirements or scope, update the relevant specs alongside your code.
5. Push to your fork and open a pull request against this repository.
