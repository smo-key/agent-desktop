<#
Agent Desktop installer for Windows.

Usage:
  irm https://smo-key.github.io/agent-desktop/install.ps1 | iex

What it does: detects your CPU architecture, downloads the matching latest
release from GitHub, verifies its sha256 against the digest GitHub publishes,
and runs the installer. It needs nothing beyond what ships with Windows (no jq,
no winget, no admin rights for a per-user install) and is short on purpose so
you can read it before piping it into a shell.

The POSIX sibling (install.sh) covers macOS and Linux. This is a separate script
because stock Windows has no POSIX shell, so a `curl | sh` one-liner cannot run
here without first installing Git Bash or WSL.

Supported today: Windows x64.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- configuration ----------------------------------------------------------

$GithubRepo   = 'smo-key/agent-desktop'
$ReleasesPage = "https://github.com/$GithubRepo/releases"
$ApiLatest    = "https://api.github.com/repos/$GithubRepo/releases/latest"
$AppName      = 'Agent Desktop'

# --- pure logic (unit-tested via docs/tests/install_ps_test.ps1) -------------

# Map an OS architecture to a platform key, or $null when unsupported.
# Mirrors platform_key() in install.sh.
function Get-PlatformKey {
    param([string]$Architecture)
    switch ($Architecture) {
        'X64'   { 'windows-x64' }
        'AMD64' { 'windows-x64' }
        'x86_64' { 'windows-x64' }
        default { $null }
    }
}

# Map a platform key to the trailing asset-name pattern, or $null.
#
# Tauri's NSIS bundle is named `<product>_<version>_x64-setup.exe`. NSIS is
# preferred over the .msi because Tauri configures it as a per-user install, so
# the one-liner does not need an elevated prompt.
function Get-AssetSuffix {
    param([string]$PlatformKey)
    switch ($PlatformKey) {
        'windows-x64' { '_x64-setup.exe' }
        default { $null }
    }
}

# Select the release asset whose name ends with $Suffix.
# $Release is the parsed releases/latest JSON. Returns $null when absent.
function Get-ReleaseAsset {
    param($Release, [string]$Suffix)
    if ($null -eq $Release) { return $null }
    if (-not $Release.PSObject.Properties.Match('assets').Count) { return $null }
    foreach ($asset in $Release.assets) {
        if ($asset.name -and $asset.name.EndsWith($Suffix, 'OrdinalIgnoreCase')) {
            return $asset
        }
    }
    return $null
}

# Extract an asset's "sha256:<hex>" digest, or $null when missing/malformed.
# Fails CLOSED: a null, absent, or non-64-hex digest yields $null so the caller
# refuses to install rather than fabricating a checksum it cannot verify.
# Mirrors asset_digest() in install.sh.
function Get-AssetDigest {
    param($Asset)
    if ($null -eq $Asset) { return $null }
    if (-not $Asset.PSObject.Properties.Match('digest').Count) { return $null }
    $digest = $Asset.digest
    if ([string]::IsNullOrWhiteSpace($digest)) { return $null }
    if ($digest -notmatch '^(?i)sha256:[0-9a-f]{64}$') { return $null }
    return $digest
}

# Compare a file's sha256 against an expected digest ("sha256:<hex>" or bare
# hex), case-insensitively. Mirrors verify_sha256() in install.sh.
function Test-Sha256 {
    param([string]$Path, [string]$Expected)
    if ([string]::IsNullOrWhiteSpace($Expected)) { return $false }
    $want = ($Expected -replace '^(?i)sha256:', '').ToLowerInvariant()
    $got = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    return $got -eq $want
}

# Friendly text for a Windows machine with no matching installer.
function Get-UnsupportedMessage {
    param([string]$Architecture)
    @(
        "$AppName has no Windows installer for $Architecture yet (x64 only).",
        "Browse all downloads: $ReleasesPage"
    ) -join [Environment]::NewLine
}

# Friendly text for "we know your platform, but this release has no asset".
function Get-NoAssetMessage {
    param([string]$Tag)
    @(
        "The latest release ($Tag) contains no Windows x64 installer.",
        "Browse all downloads: $ReleasesPage"
    ) -join [Environment]::NewLine
}

# --- side effects -----------------------------------------------------------

function Write-Log { param([string]$Message) Write-Host $Message }
function Write-Err { param([string]$Message) [Console]::Error.WriteLine($Message) }

# The architecture to install for. Overridable for testing.
function Get-HostArchitecture {
    if ($env:AGENT_DESKTOP_ARCH) { return $env:AGENT_DESKTOP_ARCH }
    return [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
}

function Get-LatestRelease {
    # TLS 1.2 for Windows PowerShell 5.1, whose default does not include it.
    try {
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch {
        # PowerShell 7+ manages this itself; nothing to do.
    }
    return Invoke-RestMethod -Uri $ApiLatest -Headers @{ 'User-Agent' = 'agent-desktop-installer' }
}

function Invoke-Install {
    $arch = Get-HostArchitecture
    $key = Get-PlatformKey -Architecture $arch
    if (-not $key) {
        Write-Err (Get-UnsupportedMessage -Architecture $arch)
        exit 1
    }

    Write-Log "→ finding the latest $AppName release…"
    try {
        $release = Get-LatestRelease
    } catch {
        Write-Err "Could not reach the GitHub releases API: $($_.Exception.Message)"
        Write-Err "Browse all downloads: $ReleasesPage"
        exit 1
    }

    $suffix = Get-AssetSuffix -PlatformKey $key
    $asset = Get-ReleaseAsset -Release $release -Suffix $suffix
    if (-not $asset) {
        Write-Err (Get-NoAssetMessage -Tag $release.tag_name)
        exit 1
    }

    # Refuse to install anything we cannot verify.
    $digest = Get-AssetDigest -Asset $asset
    if (-not $digest) {
        Write-Err "The release metadata has no usable sha256 for $($asset.name) — refusing to install."
        exit 1
    }

    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("agent-desktop-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    try {
        $file = Join-Path $tmp $asset.name
        Write-Log "→ downloading $($asset.name)…"
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $file -UseBasicParsing

        Write-Log '→ verifying checksum…'
        if (-not (Test-Sha256 -Path $file -Expected $digest)) {
            Write-Err 'Checksum verification failed — refusing to install.'
            exit 1
        }

        Write-Log "→ running the installer…"
        # NSIS: /S is a silent, per-user install. Wait so we can report the result
        # and so the temp dir is not removed out from under a running installer.
        $proc = Start-Process -FilePath $file -ArgumentList '/S' -PassThru -Wait
        if ($proc.ExitCode -ne 0) {
            Write-Err "The installer exited with code $($proc.ExitCode)."
            exit $proc.ExitCode
        }
        Write-Log "✓ Installed $AppName. Look for it in the Start menu."
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}

# Run only when executed directly, not when dot-sourced for tests.
# Mirrors install.sh's AGENT_DESKTOP_INSTALL_LIB guard.
if ($env:AGENT_DESKTOP_INSTALL_LIB -ne '1') {
    Invoke-Install
}
