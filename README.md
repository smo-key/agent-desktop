# Agent Desktop

A desktop app to manage AI coding agents — for people who run lots of agents but only want to think about one thing at a time.

## Features

- **Project workspace** — organize working folders into named, color-coded projects with per-project terminals, tasks, and git state.
- **Agent orchestration** — launch and coordinate multiple agent sessions, with an orchestrator that manages the fleet over MCP.
- **Built-in terminals** — full xterm terminals with file links, filename insertion, and a tiling layout that persists across restarts.
- **Git integration** — push, pull, and switch branches per project from context menus and the app footer.
- **Voice dictation** — dictate into any input with a floating voice panel and on-device transcription (no cloud round-trip).
- **Usage dashboard** — track activity and agent usage at a glance.

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
`package.json`'s `version` is the single source of truth: **bump it and push to
`main`**, and CI does the rest.

1. Bump `version` in `package.json` (e.g. `0.1.0` → `0.1.1`) and push to `main`.
2. The workflow detects the bump (the version is higher than the latest `v*`
   tag), syncs the version into `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
   and `Cargo.lock`, regenerates `CHANGELOG.md` from the conventional commits, and
   commits that back as `chore(release): vX.Y.Z [skip ci]`, then tags `vX.Y.Z`.
3. A five-target native matrix (macOS arm64 + Intel, Windows x86_64, Linux x86_64
   + arm64) builds the app, provisions its own-arch sidecars, runs `check:gate`,
   and publishes signed installers to a single GitHub Release whose notes are the
   grouped conventional-commit changelog.

Pushing a commit that does **not** raise the version publishes nothing. You can
also trigger a manual build from the Actions tab (`workflow_dispatch`).

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
