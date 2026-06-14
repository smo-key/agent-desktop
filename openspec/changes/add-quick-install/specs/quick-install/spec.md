## ADDED Requirements

### Requirement: Stable one-line install command
The installer script SHALL be reachable at the stable URL
`https://smo-key.github.io/agent-desktop/install.sh` and SHALL be executable by
piping it into a POSIX shell, so that a user can install Agent Desktop with a
single copy-paste command.

#### Scenario: Fetch and run via curl

- **WHEN** a user runs `curl -fsSL https://smo-key.github.io/agent-desktop/install.sh | sh` on a supported platform
- **THEN** the script runs to completion and installs the latest release without requiring any additional flags or arguments

#### Scenario: Script is served by GitHub Pages

- **WHEN** GitHub Pages is enabled with source `main` branch `/docs`
- **THEN** the file `docs/install.sh` is served at the stable URL above with a shell-script content type

### Requirement: Platform detection
The installer SHALL detect the operating system and CPU architecture from
`uname` and SHALL treat macOS arm64, Linux x86_64, and Linux arm64 as the
supported targets.

#### Scenario: macOS Apple Silicon detected

- **WHEN** the script runs on a host where `uname -s` is `Darwin` and `uname -m` is `arm64`
- **THEN** the script selects the macOS Apple Silicon install path

#### Scenario: Linux architecture detected

- **WHEN** the script runs on a host where `uname -s` is `Linux` and `uname -m` is `x86_64` or `aarch64`
- **THEN** the script selects the matching Linux AppImage install path

### Requirement: Unsupported platform handling
The installer SHALL exit with a non-zero status and a friendly message when run
on a platform without a published asset, and SHALL NOT perform a partial
installation.

#### Scenario: Windows or Intel Mac

- **WHEN** the script runs on Windows, an Intel Mac, or any target with no matching release asset
- **THEN** it prints a message naming the platform, links to the GitHub releases page, notes that support is coming soon, and exits non-zero without downloading or installing anything

### Requirement: Latest-asset resolution
The installer SHALL query the GitHub `releases/latest` REST endpoint and select
the asset whose name matches the detected platform, and it SHALL do so without
depending on `jq` so that it runs on a stock macOS.

#### Scenario: Asset matched for platform

- **WHEN** the latest release contains an asset matching the platform pattern (`*_aarch64.dmg` for macOS arm64, `*_amd64.AppImage` for Linux x86_64, `*_aarch64.AppImage` for Linux arm64)
- **THEN** the script resolves that asset's download URL and sha256 digest using only POSIX text tools (no `jq`)

#### Scenario: No matching asset in latest release

- **WHEN** the latest release exists but contains no asset matching the detected platform
- **THEN** the script reports that no installer is available for the platform and exits non-zero without installing

### Requirement: Download integrity verification
The installer SHALL verify the downloaded asset against the sha256 `digest`
reported by the GitHub API before installing, and SHALL abort on mismatch. It
SHALL accept only a well-formed `sha256:<64 hex>` digest belonging to the matched
asset, and SHALL refuse to install (rather than install unverified) when no such
digest is available.

#### Scenario: Digest matches

- **WHEN** the sha256 of the downloaded file equals the API-provided digest
- **THEN** the script proceeds to install

#### Scenario: Digest mismatch

- **WHEN** the sha256 of the downloaded file does not equal the API-provided digest
- **THEN** the script prints an integrity-failure error, removes the downloaded file, and exits non-zero without installing

#### Scenario: Asset has no usable digest

- **WHEN** the matched asset's digest is missing, `null`, or not a `sha256:<64 hex>` value, or would be drawn from a different asset
- **THEN** the script refuses to install, reports that no verifiable installer was found, and points the user to the releases page for a manual download

### Requirement: macOS installation
On macOS the installer SHALL install the application from the downloaded `.dmg`
into an Applications directory and SHALL clear the quarantine attribute on a
best-effort basis so the first launch is not blocked by Gatekeeper.

#### Scenario: Install into Applications

- **WHEN** the `.dmg` is downloaded and verified
- **THEN** the script mounts it, copies `Agent Desktop.app` into `/Applications`, and unmounts the image afterward

#### Scenario: Applications not writable

- **WHEN** `/Applications` is not writable by the current user
- **THEN** the script installs into `~/Applications` instead and never invokes `sudo`

#### Scenario: Quarantine cleared best-effort

- **WHEN** the app has been copied into place
- **THEN** the script runs `xattr -dr com.apple.quarantine` on the installed `.app`, and if that command fails the installation still completes successfully

### Requirement: Linux installation
On Linux the installer SHALL install the downloaded `.AppImage` as an executable
in the user's local bin directory and SHALL register a desktop launcher entry so
the app appears in the application menu, without requiring root.

#### Scenario: AppImage installed and launchable

- **WHEN** the `.AppImage` is downloaded and verified
- **THEN** the script places it under `~/.local/bin`, marks it executable, and writes a `.desktop` entry under `~/.local/share/applications` referencing it

### Requirement: Non-interactive safety
The installer SHALL detect when no controlling terminal is available and SHALL
behave safely without prompting, never invoking `sudo` and never auto-launching
the app.

#### Scenario: Run without a TTY

- **WHEN** the script runs in an environment with no controlling terminal (for example piped in CI)
- **THEN** it skips all interactive prompts, falls back to `~/Applications` on macOS rather than prompting or using sudo, completes the install, and does not launch the app

#### Scenario: Interactive launch offer

- **WHEN** a controlling terminal is available after a successful install
- **THEN** the script offers to launch the app, reading the response from the terminal rather than from the piped stdin
