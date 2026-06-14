## Context

Releases are published to GitHub as a single Release per version carrying ~15
assets (per-OS installers + updater artifacts + sigs). Asset names embed the
version and an arch token that differs by bundle type, e.g.:

- macOS Apple Silicon: `Agent.Desktop_<ver>_aarch64.dmg`
- Linux x86_64: `Agent.Desktop_<ver>_amd64.AppImage`
- Linux arm64: `Agent.Desktop_<ver>_aarch64.AppImage`

The `releases/latest` REST endpoint returns only the latest **published**
(non-draft, non-prerelease) release and, for each asset, a `browser_download_url`
plus a `digest` field of the form `sha256:<hex>`. The macOS builds are signed and
notarized in CI, so the only first-launch friction is the `com.apple.quarantine`
attribute that a `curl` download stamps on the file.

There is currently no macOS-Intel build leg and the Windows build leg is failing,
so those assets do not exist yet (tracked as a separate follow-up).

## Goals / Non-Goals

**Goals:**

- A single copy-paste command installs a ready-to-run app on macOS arm64 and
  Linux x86_64/arm64.
- Zero non-standard dependencies: runs on a stock macOS shell (no `jq`,
  no Homebrew).
- Safe to `curl | sh`: integrity-verified, short, auditable, and well-behaved
  with no TTY.

**Non-Goals:**

- Windows (`install.ps1`) and Intel-Mac support — blocked on CI work, tracked
  separately.
- A graphical download landing page (the `docs/index.html` is only a placeholder
  to reserve the Pages site).
- In-app auto-update (already handled by the Tauri updater + `latest.json`).
- System package installation (`.deb`/`.rpm`); AppImage keeps Linux rootless.

## Decisions

- **Language: POSIX `sh` with `set -eu`.** Targets `/bin/sh` so the `| sh`
  invocation works everywhere; avoids bash-only constructs. macOS ships an old
  bash, so POSIX sh is the safe floor.
- **JSON parsing without `jq`.** The latest-release JSON is parsed with
  `grep`/`sed`/`tr`: locate the asset block by name pattern, then extract its
  `browser_download_url` and `digest`. A stock macOS has no `jq`; requiring it
  would break the one-liner. The parser keys off the asset *name* (stable,
  arch-specific), not array position.
- **Arch mapping.** `uname -s`/`uname -m` → platform key → asset name glob:
  `Darwin`+`arm64` → `*_aarch64.dmg`; `Linux`+`x86_64` → `*_amd64.AppImage`;
  `Linux`+`aarch64` → `*_aarch64.AppImage`. Everything else is "unsupported".
- **Integrity via API digest.** sha256 is computed with `shasum -a 256` (macOS)
  or `sha256sum` (Linux) and compared to the API `digest` (strip the `sha256:`
  prefix, case-insensitive compare). The `.dmg` has no `.sig` asset, so the API
  digest — not the Tauri minisign signature — is the integrity source.
- **macOS install.** `hdiutil attach -nobrowse -quiet` → copy
  `Agent Desktop.app` to `/Applications` when writable, else `~/Applications`
  (never `sudo`) → `xattr -dr com.apple.quarantine "<app>"` wrapped to ignore
  failure → `hdiutil detach -quiet`.
- **Linux install.** Copy AppImage to `~/.local/bin/agent-desktop.AppImage`,
  `chmod +x`, write `~/.local/share/applications/agent-desktop.desktop` pointing
  at it (with `Name`, `Exec`, `Terminal=false`, `Categories`).
- **TTY handling.** When piped via `curl | sh`, the script's stdin is the script
  text, so interactive prompts read from `/dev/tty`. If `/dev/tty` is
  unavailable (no controlling terminal), the script runs fully non-interactively:
  no prompts, no `sudo`, fall back to `~/Applications`, no auto-launch.
- **Hosting via GitHub Pages from `main` `/docs`.** The repo already builds from
  `main`; serving `docs/` needs no separate branch or build step. The script
  lives at `docs/install.sh`; `docs/index.html` is a placeholder. Repo owner
  must enable Pages once (source: `main` `/docs`).
- **Testing strategy.** The platform-detection, arch-mapping, asset-pattern, and
  JSON-extraction logic are factored into small shell functions tested with a
  shell test harness (e.g. `bats` or a plain `sh` assertion script) using
  recorded API JSON fixtures and `uname` stubs. Network, `hdiutil`, and `xattr`
  side effects are guarded behind seams so the pure logic is unit-testable
  without a real download.

## Risks / Trade-offs

- **`curl | sh` trust.** Mitigated by keeping the script short and readable,
  verifying the sha256 digest, using HTTPS only, and documenting that users can
  read the script first. Accepted as the cost of a one-liner.
- **Pages CDN caching.** Updates to `install.sh` propagate with a few minutes of
  CDN delay; acceptable for an installer that always resolves the *latest*
  release at run time (the script content changes rarely).
- **Hand-rolled JSON parsing.** More fragile than `jq` if GitHub changes its
  payload shape; mitigated by matching on stable asset-name patterns and covering
  the parser with fixture-based tests. Revisit if the payload format changes.
- **`/Applications` vs `~/Applications` split.** Installing to `~/Applications`
  when the system dir is not writable avoids a `sudo` prompt but means the app is
  per-user; acceptable and arguably preferable for an unattended one-liner.
- **GitHub API rate limits.** Unauthenticated `releases/latest` calls are
  rate-limited per IP; a single install is one request, so this is a non-issue in
  practice.
