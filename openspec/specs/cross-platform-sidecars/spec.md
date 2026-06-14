# cross-platform-sidecars Specification

## Purpose
TBD - created by archiving change add-desktop-release-ci. Update Purpose after archive.
## Requirements
### Requirement: Host-aware sidecar provisioning

The sidecar provisioning scripts (`fetch-whisper.sh`, `fetch-llama.sh`) SHALL
derive the target triple and build architecture from the host platform, with an
explicit environment override, and SHALL default to `aarch64-apple-darwin` when no
override is given so existing local Apple-Silicon development is unchanged. Each
script SHALL produce its binaries named `<name>-<triple>` (with the platform
executable suffix where applicable) as required by Tauri's `externalBin`
convention.

#### Scenario: Local Apple Silicon default

- **WHEN** `fetch-whisper.sh` or `fetch-llama.sh` runs on Apple Silicon with no
  override
- **THEN** it builds the `aarch64-apple-darwin` sidecars, exactly as before this
  change

#### Scenario: Explicit target override

- **WHEN** a script runs with the target triple/arch override set
- **THEN** it builds for that target and names the binary with the matching triple
  suffix

### Requirement: Native sidecar builds per supported OS/arch

The provisioning SHALL produce `whisper-cli`, `whisper-server`, and `llama-server`
for each supported target — macOS arm64, macOS x86_64, Windows x86_64, Linux
x86_64, and Linux arm64 — built with that target's native toolchain. On Windows
the binaries SHALL be native MSVC PE executables (built via cmake's MSVC
generator, runnable from the bash provisioning script under Git Bash), not Linux
binaries produced under WSL.

#### Scenario: Windows native sidecars

- **WHEN** sidecars are provisioned on the Windows runner
- **THEN** the produced `whisper-cli.exe`, `whisper-server.exe`, and
  `llama-server.exe` are native Windows PE binaries suffixed with the
  `x86_64-pc-windows-msvc` triple

#### Scenario: Linux sidecars per arch

- **WHEN** sidecars are provisioned on a Linux x86_64 or Linux arm64 runner
- **THEN** the produced binaries are ELF executables for that architecture, named
  with the matching Linux triple

### Requirement: Sidecar artifact validation

Before bundling, the build SHALL verify that each provisioned sidecar is an
executable of the expected binary format and architecture for the target, and
SHALL fail the build for that target if a sidecar is missing or mismatched.

#### Scenario: Mismatched sidecar rejected

- **WHEN** a provisioned sidecar's format or architecture does not match the build
  target
- **THEN** that target's build fails with a clear error rather than bundling the
  wrong binary

### Requirement: Bundled model provisioning is cross-platform

The `fetch-models.sh` script SHALL download the bundled `ggml-tiny.bin` model on
every supported build OS (macOS, Windows under Git Bash, and Linux), since the
model is architecture-independent and bundled as a Tauri resource on all targets.

#### Scenario: Model present on every target

- **WHEN** any supported target builds
- **THEN** `ggml-tiny.bin` is provisioned and bundled as a resource in that
  target's artifact

