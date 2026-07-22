## ADDED Requirements

### Requirement: One-line Windows install command

A Windows installer script SHALL be reachable at the stable URL
`https://smo-key.github.io/agent-desktop/install.ps1` and SHALL be executable by
piping it into PowerShell, so a Windows user can install Agent Desktop with a
single copy-paste command.

PowerShell is used rather than extending `install.sh`, because stock Windows has
no POSIX shell — a `curl | sh` one-liner cannot run there without first
installing Git Bash or WSL.

#### Scenario: Fetch and run via PowerShell

- **WHEN** a user runs `irm https://smo-key.github.io/agent-desktop/install.ps1 | iex`
  on Windows x64
- **THEN** the script runs to completion and installs the latest release without
  requiring any additional flags or arguments

#### Scenario: Script is served by GitHub Pages

- **WHEN** GitHub Pages is enabled with source `main` branch `/docs`
- **THEN** the file `docs/install.ps1` is served at the stable URL above

### Requirement: Windows asset resolution and integrity verification

The Windows installer SHALL query the GitHub `releases/latest` REST endpoint,
select the asset matching the detected architecture, verify the download against
the release metadata's sha256 `digest`, and refuse to install on a mismatch.

Verification SHALL use only what ships with Windows PowerShell (no `jq`, no
external tools), so the command works on a stock machine.

#### Scenario: Asset matched and verified

- **WHEN** the latest release contains a Windows x64 installer asset
- **THEN** the script resolves that asset's download URL and sha256 digest, and
  installs it only after the downloaded file's hash matches

#### Scenario: Checksum mismatch refuses to install

- **WHEN** a downloaded Windows asset's sha256 does not match the digest in the
  release metadata
- **THEN** the script reports the mismatch and exits non-zero WITHOUT running the
  installer

#### Scenario: No Windows asset in the latest release

- **WHEN** the latest release contains no asset matching Windows x64
- **THEN** the script reports that no Windows installer is available for that
  release, links to the releases page, and exits non-zero without installing

#### Scenario: Unsupported Windows architecture

- **WHEN** the script runs on a Windows machine that is not x64 (e.g. arm64)
- **THEN** it reports the unsupported architecture and exits non-zero without
  downloading or installing anything

### Requirement: The POSIX installer points Windows users at the PowerShell command

The POSIX installer SHALL, when it detects a Windows-like environment (e.g. run
under Git Bash, MSYS, or Cygwin), print the PowerShell one-line command rather
than describing Windows as unsupported or "coming soon".

#### Scenario: install.sh run under Git Bash

- **WHEN** `install.sh` runs on a host whose `uname -s` reports a Windows-like
  environment such as `MINGW64_NT` / `MSYS_NT` / `CYGWIN_NT`
- **THEN** it prints the `install.ps1` PowerShell command to run instead, and
  exits non-zero without installing anything

#### Scenario: Non-Windows unsupported platform is unchanged

- **WHEN** `install.sh` runs on a still-unsupported non-Windows platform (e.g. an
  Intel Mac)
- **THEN** it prints the existing unsupported-platform message and exits non-zero
