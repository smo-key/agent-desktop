## MODIFIED Requirements

### Requirement: Multi-platform build matrix

The pipeline SHALL build the app natively for four targets — `aarch64-apple-darwin`,
`x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`, and
`aarch64-unknown-linux-gnu` — each on a runner of its own architecture, with
`fail-fast` disabled so one target's failure does not cancel the others. Linux
runners SHALL install the Tauri system dependencies before building. (The macOS
Intel target `x86_64-apple-darwin` is intentionally excluded: it requires the
`macos-13` Intel runner, which GitHub is retiring, and Apple-Silicon `.dmg`s
plus Rosetta cover Intel Macs.)

**All four targets are required.** No leg SHALL be `continue-on-error`: a build
failure on any target hard-fails the matrix and blocks publishing. (Windows was
previously best-effort because `src-tauri` did not compile there; now that its IPC
uses a cross-platform local socket, a Windows break is a real regression and SHALL
stop the release rather than silently publishing without the Windows installer.)

#### Scenario: All targets build their native installers

- **WHEN** a release builds
- **THEN** each matrix target produces its platform installer(s) (macOS `.dmg`,
  Windows `.msi`/NSIS `.exe`, Linux `.deb`/AppImage) built on a runner of the
  matching architecture

#### Scenario: One target fails

- **WHEN** one matrix target fails to build
- **THEN** the remaining targets continue and still produce their artifacts
  (`fail-fast` is disabled), but the matrix as a whole fails

#### Scenario: A failing Windows leg blocks the release

- **WHEN** the Windows leg fails to build while macOS and Linux succeed
- **THEN** the build matrix fails, the release is NOT published, and it stays a
  draft
- **AND** no release is published that is missing the Windows installer

#### Scenario: A failing macOS or Linux leg blocks the release

- **WHEN** the macOS or a Linux leg fails to build
- **THEN** the build matrix fails, the release is NOT published, and it stays a
  draft

### Requirement: Single GitHub Release with all platform artifacts

The pipeline SHALL create exactly one GitHub Release per version, tagged
`v<version>`, as a **draft** up front, attach every successful target's
installers to it, and then **publish (undraft)** it once the build matrix
completes successfully for **all four targets**. If any target fails the release
SHALL remain a draft.

#### Scenario: Release published with attachments

- **WHEN** the build matrix completes for version `X` with all four targets
  succeeding
- **THEN** the single GitHub Release `vX` is flipped from draft to published with
  every platform's installer(s) attached, including the Windows installer

#### Scenario: Release stays a draft when a target fails

- **WHEN** any target fails to build for version `X`
- **THEN** the release `vX` remains a draft and is not published

## ADDED Requirements

### Requirement: The Windows installer bundles the WebView2 runtime

The Windows installer SHALL ensure the WebView2 runtime is available on the target
machine, using Tauri's download-bootstrapper strategy so the shipped installer
stays small and fetches the runtime at install time only when it is missing.

#### Scenario: Installing on a machine without WebView2

- **WHEN** the Windows installer runs on a machine that lacks the WebView2 runtime
- **THEN** the runtime is obtained during installation and the app launches
  afterwards, rather than failing silently at startup

### Requirement: Windows compilation is gated before release

The pipeline SHALL verify that `src-tauri` compiles for `x86_64-pc-windows-msvc`
as a fast, release-blocking check, so a Windows-breaking change is caught without
waiting for a full bundle.

#### Scenario: A change breaks the Windows build

- **WHEN** a change that does not compile for Windows is pushed
- **THEN** the Windows compilation check fails and reports the compile errors
