<#
Agent Desktop installer for Windows.

Usage:
  irm https://smo-key.github.io/agent-desktop/install.ps1 | iex
  & ([scriptblock]::Create((irm https://smo-key.github.io/agent-desktop/install.ps1))) beta

The optional argument picks the release train: stable (the default) or beta.
The piped form above cannot take arguments, which is why the beta line wraps the
script in a scriptblock — that is the only difference between them.

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

param(
    # The release train to install: 'stable' (default) or 'beta'.
    # Bound positionally or by name through the scriptblock form:
    #   & ([scriptblock]::Create((irm <url>))) beta
    # The documented `irm <url> | iex` form passes nothing and gets stable.
    [string]$Channel
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- configuration ----------------------------------------------------------

$GithubRepo   = 'smo-key/agent-desktop'
$ReleasesPage = "https://github.com/$GithubRepo/releases"
$ApiLatest    = "https://api.github.com/repos/$GithubRepo/releases/latest"
# The beta channel needs the full list: releases/latest EXCLUDES prereleases by
# definition, which is exactly what keeps stable users off them.
$ApiReleases  = "https://api.github.com/repos/$GithubRepo/releases?per_page=30"
$ApiTagPrefix = "https://api.github.com/repos/$GithubRepo/releases/tags"
$AppName      = 'Agent Desktop'
# This script's own URL, quoted back when a beta is asked for but none exists.
$PsInstallUrl = 'https://smo-key.github.io/agent-desktop/install.ps1'

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

# Normalize a channel argument to 'stable' or 'beta', or $null when it is
# neither. Mirrors parse_channel() in install.sh.
#
# An unknown value yields $null rather than a default: silently installing
# stable because 'beta' was misspelled hands the user a different release train
# than the one they asked for, with nothing on screen to say so.
function Get-ChannelName {
    param([string]$Channel)
    if ([string]::IsNullOrWhiteSpace($Channel)) { return 'stable' }
    switch ($Channel.ToLowerInvariant()) {
        'stable' { 'stable' }
        'beta'   { 'beta' }
        default  { $null }
    }
}

# The tag of the newest installable prerelease in a parsed `GET /releases` list,
# or $null when there is none. Mirrors newest_prerelease_tag() in install.sh.
#
# The list arrives newest-first. Drafts are skipped even though they ARE
# prereleases: a release run that fails after uploading some assets leaves a
# draft holding a partial set (this repo had exactly that for v0.4.0-2), and
# installing from one would download a half-published release.
function Get-NewestPrereleaseTag {
    param($Releases)
    if ($null -eq $Releases) { return $null }
    foreach ($release in $Releases) {
        if (-not $release.PSObject.Properties.Match('prerelease').Count) { continue }
        if (-not $release.prerelease) { continue }
        if ($release.PSObject.Properties.Match('draft').Count -and $release.draft) { continue }
        if ([string]::IsNullOrWhiteSpace($release.tag_name)) { continue }
        return $release.tag_name
    }
    return $null
}

# Closing guidance for a channel ('' for stable). Mirrors channel_hint().
#
# Installing a beta BUILD does not put the app on the beta CHANNEL — that is a
# separate in-app preference. Without this the user gets exactly one beta and
# then never hears about another, with no way to guess why.
function Get-ChannelHint {
    param([string]$Channel)
    if ($Channel -ne 'beta') { return '' }
    @(
        "You are on a beta build. To keep receiving betas, open $AppName",
        'and choose Beta under Settings -> Software update.'
    ) -join [Environment]::NewLine
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
        "Release $Tag contains no Windows x64 installer.",
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

# TLS 1.2 for Windows PowerShell 5.1, whose default does not include it.
function Initialize-Tls {
    try {
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch {
        # PowerShell 7+ manages this itself; nothing to do.
    }
}

function Invoke-GitHubApi {
    param([string]$Uri)
    Initialize-Tls
    return Invoke-RestMethod -Uri $Uri -Headers @{ 'User-Agent' = 'agent-desktop-installer' }
}

function Get-LatestRelease {
    return Invoke-GitHubApi -Uri $ApiLatest
}

# The releases LIST, which unlike releases/latest includes prereleases.
function Get-ReleasesList {
    return Invoke-GitHubApi -Uri $ApiReleases
}

# One release by tag. Returns the same shape as releases/latest, so asset
# matching, digest verification and installation are shared unchanged.
function Get-ReleaseByTag {
    param([string]$Tag)
    return Invoke-GitHubApi -Uri "$ApiTagPrefix/$Tag"
}

function Invoke-Install {
    param([string]$Channel)

    # Resolve the channel BEFORE anything else: a typo must fail as a typo, not
    # as a confusing network error on a machine that happens to be offline.
    $resolved = Get-ChannelName -Channel $Channel
    if (-not $resolved) {
        Write-Err "Unknown channel: $Channel"
        Write-Err "Use 'beta', or leave it out for the stable release."
        exit 1
    }

    $arch = Get-HostArchitecture
    $key = Get-PlatformKey -Architecture $arch
    if (-not $key) {
        Write-Err (Get-UnsupportedMessage -Architecture $arch)
        exit 1
    }

    Write-Log "→ channel: $resolved"
    try {
        if ($resolved -eq 'beta') {
            Write-Log "→ looking for the newest beta…"
            $tag = Get-NewestPrereleaseTag -Releases (Get-ReleasesList)
            if (-not $tag) {
                Write-Err 'No beta build has been published yet.'
                Write-Err "Install the stable release instead: irm $PsInstallUrl | iex"
                exit 1
            }
            Write-Log "→ newest beta: $tag"
            $release = Get-ReleaseByTag -Tag $tag
        } else {
            Write-Log "→ finding the latest $AppName release…"
            $release = Get-LatestRelease
        }
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
        $hint = Get-ChannelHint -Channel $resolved
        if ($hint) { Write-Log $hint }
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}

# Run only when executed directly, not when dot-sourced for tests.
# Mirrors install.sh's AGENT_DESKTOP_INSTALL_LIB guard.
if ($env:AGENT_DESKTOP_INSTALL_LIB -ne '1') {
    Invoke-Install -Channel $Channel
}
