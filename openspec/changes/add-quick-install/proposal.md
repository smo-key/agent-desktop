## Why

GitHub Releases now publish signed, notarized installers for Agent Desktop, but
there is no quick path for a user to actually get one onto their machine — they
must navigate to the releases page, decode which of ~15 assets matches their OS
and CPU, download it, and clear macOS Gatekeeper by hand. A single copy-paste
command removes that friction now that there is something real to download.

## What Changes

- Add **`install.sh`**, a POSIX shell installer run as
  `curl -fsSL https://smo-key.github.io/agent-desktop/install.sh | sh`, that
  detects the platform, downloads the matching latest-release asset, verifies its
  sha256, and installs a ready-to-run app.
  - **macOS (Apple Silicon):** mount the `.dmg`, copy `Agent Desktop.app` into
    `/Applications` (fallback `~/Applications` when not writable — never forces
    `sudo`), strip `com.apple.quarantine` best-effort so the first launch is not
    blocked, unmount, and offer to launch.
  - **Linux (x86_64 / arm64):** install the `.AppImage` into `~/.local/bin`,
    mark it executable, and write a `.desktop` launcher entry so it appears in
    the app menu; offer to launch.
  - Unsupported targets (Windows, Intel Mac) exit with a friendly message
    pointing at the releases page and noting they are coming soon.
- **Host the script via GitHub Pages** from `main` → `/docs`, with the script at
  `docs/install.sh` and a minimal `docs/index.html` placeholder to grow into a
  download landing page later.
- **Document** the one-liner in `README.md` under an `## Install` section, with a
  manual-download fallback link.

Out of scope for this change (tracked as a follow-up): a Windows `install.ps1`,
fixing the failing Windows build leg, adding an Intel-Mac (`x86_64-apple-darwin`)
build leg, and investigating why the `publish-release` job was skipped while the
release still published.

## Capabilities

### New Capabilities
- `quick-install`: A one-command, platform-detecting installer for published
  releases — asset resolution from the latest GitHub Release, integrity
  verification, and per-OS installation/launch behavior, hosted at a stable URL.

### Modified Capabilities
<!-- None: no existing spec's requirements change. -->

## Impact

- **New files:** `docs/install.sh` (installer), `docs/index.html` (Pages
  placeholder).
- **Modified:** `README.md` (Install section).
- **Repo settings:** GitHub Pages enabled (source: `main` branch, `/docs`).
- **External dependency:** relies on the public GitHub Releases REST API
  (`/releases/latest`) and the per-asset `digest` (sha256) field for
  verification; no new build/runtime code dependencies, and the script avoids
  `jq` (pure `grep`/`sed`) so it runs on a stock macOS.
- **No changes** to the Tauri app, the release workflow, or signing.
