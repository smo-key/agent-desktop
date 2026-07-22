<#
Unit tests for the PURE logic in docs/install.ps1.

Run:  pwsh -NoProfile -File docs/tests/install_ps_test.ps1

These cannot run in the main `yarn test:install` suite: that harness is POSIX sh
on macOS/Linux runners, which have no PowerShell. They run on the Windows CI
runner instead (see the `windows-check` job), where PowerShell is native — the
only place this script's real interpreter exists.

Deliberately no Pester dependency: a stock Windows box must be able to run this.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Load install.ps1 as a library (defines functions, does not run the installer).
$env:AGENT_DESKTOP_INSTALL_LIB = '1'
. (Join-Path $PSScriptRoot '..' 'install.ps1')

$script:Run = 0
$script:Failed = 0

function Assert-Eq {
    param($Actual, $Expected, [string]$Message)
    $script:Run++
    if ($Actual -eq $Expected) {
        Write-Host "  ok   $Message"
    } else {
        $script:Failed++
        Write-Host "  FAIL $Message"
        Write-Host "         expected: $(if ($null -eq $Expected) { '<null>' } else { $Expected })"
        Write-Host "         actual:   $(if ($null -eq $Actual) { '<null>' } else { $Actual })"
    }
}

function Assert-Null {
    param($Actual, [string]$Message)
    Assert-Eq -Actual ($null -eq $Actual) -Expected $true -Message $Message
}

function Assert-True {
    param($Actual, [string]$Message)
    Assert-Eq -Actual $Actual -Expected $true -Message $Message
}

function Assert-False {
    param($Actual, [string]$Message)
    Assert-Eq -Actual $Actual -Expected $false -Message $Message
}

# A releases/latest payload shaped like the GitHub REST response.
function New-Release {
    param([object[]]$Assets, [string]$Tag = 'v9.9.9')
    return [pscustomobject]@{ tag_name = $Tag; assets = $Assets }
}
function New-Asset {
    param([string]$Name, [string]$Digest = $null, [string]$Url = 'https://example.test/a')
    $a = [pscustomobject]@{ name = $Name; browser_download_url = $Url }
    if ($null -ne $Digest) { $a | Add-Member -NotePropertyName digest -NotePropertyValue $Digest }
    return $a
}

Write-Host "`n# install.ps1 — architecture detection"

Assert-Eq (Get-PlatformKey 'X64')    'windows-x64' 'X64 -> windows-x64'
Assert-Eq (Get-PlatformKey 'AMD64')  'windows-x64' 'AMD64 -> windows-x64'
Assert-Eq (Get-PlatformKey 'x86_64') 'windows-x64' 'x86_64 -> windows-x64'
Assert-Null (Get-PlatformKey 'Arm64') 'Windows on ARM is unsupported'
Assert-Null (Get-PlatformKey 'X86')   '32-bit x86 is unsupported'
Assert-Null (Get-PlatformKey '')      'empty arch is unsupported'

Write-Host "`n# install.ps1 — asset suffix"

Assert-Eq (Get-AssetSuffix 'windows-x64') '_x64-setup.exe' 'windows-x64 -> NSIS setup suffix'
Assert-Null (Get-AssetSuffix 'bogus-key') 'unknown key has no suffix'

Write-Host "`n# install.ps1 — asset resolution"

$release = New-Release -Assets @(
    (New-Asset -Name 'Agent Desktop_1.2.3_aarch64.dmg'),
    (New-Asset -Name 'Agent Desktop_1.2.3_x64_en-US.msi'),
    (New-Asset -Name 'Agent Desktop_1.2.3_x64-setup.exe' -Url 'https://example.test/setup.exe'),
    (New-Asset -Name 'Agent Desktop_1.2.3_amd64.AppImage')
)
$asset = Get-ReleaseAsset -Release $release -Suffix '_x64-setup.exe'
Assert-Eq $asset.name 'Agent Desktop_1.2.3_x64-setup.exe' 'picks the NSIS setup, not the .msi or .dmg'
Assert-Eq $asset.browser_download_url 'https://example.test/setup.exe' 'resolves that asset own url'

# The .msi ends with `.msi`, so the suffix must not loosely match on `x64`.
Assert-Null (Get-ReleaseAsset -Release (New-Release -Assets @(
    (New-Asset -Name 'Agent Desktop_1.2.3_x64_en-US.msi')
)) -Suffix '_x64-setup.exe') 'an .msi alone does not satisfy the NSIS suffix'

Assert-Null (Get-ReleaseAsset -Release (New-Release -Assets @()) -Suffix '_x64-setup.exe') `
    'a release with no assets yields nothing'
Assert-Null (Get-ReleaseAsset -Release $null -Suffix '_x64-setup.exe') 'a null release yields nothing'

Write-Host "`n# install.ps1 — digest extraction fails closed"

$valid = 'sha256:' + ('a' * 64)
Assert-Eq (Get-AssetDigest (New-Asset -Name 'x_x64-setup.exe' -Digest $valid)) $valid 'a well-formed digest is returned'
Assert-Eq (Get-AssetDigest (New-Asset -Name 'x' -Digest ('SHA256:' + ('A' * 64)))) ('SHA256:' + ('A' * 64)) `
    'an uppercase SHA256: label is accepted'
Assert-Null (Get-AssetDigest (New-Asset -Name 'x')) 'a missing digest is rejected'
Assert-Null (Get-AssetDigest (New-Asset -Name 'x' -Digest '')) 'an empty digest is rejected'
Assert-Null (Get-AssetDigest (New-Asset -Name 'x' -Digest ('sha256:' + ('a' * 63)))) 'a short hex digest is rejected'
Assert-Null (Get-AssetDigest (New-Asset -Name 'x' -Digest ('sha256:' + ('z' * 64)))) 'a non-hex digest is rejected'
Assert-Null (Get-AssetDigest (New-Asset -Name 'x' -Digest ('md5:' + ('a' * 64)))) 'a non-sha256 algorithm is rejected'
Assert-Null (Get-AssetDigest $null) 'a null asset is rejected'

Write-Host "`n# install.ps1 — checksum verification"

$tmpFile = Join-Path ([System.IO.Path]::GetTempPath()) ("adtest-" + [Guid]::NewGuid().ToString('N') + '.bin')
try {
    [System.IO.File]::WriteAllText($tmpFile, 'agent-desktop')
    $real = (Get-FileHash -Path $tmpFile -Algorithm SHA256).Hash.ToLowerInvariant()

    Assert-True (Test-Sha256 -Path $tmpFile -Expected $real) 'bare hex matches'
    Assert-True (Test-Sha256 -Path $tmpFile -Expected "sha256:$real") 'sha256:-prefixed matches'
    Assert-True (Test-Sha256 -Path $tmpFile -Expected $real.ToUpperInvariant()) 'comparison is case-insensitive'
    Assert-False (Test-Sha256 -Path $tmpFile -Expected ('sha256:' + ('b' * 64))) 'a wrong digest fails'
    Assert-False (Test-Sha256 -Path $tmpFile -Expected '') 'an empty expectation fails rather than passing'
} finally {
    Remove-Item -Force $tmpFile -ErrorAction SilentlyContinue
}

Write-Host "`n# install.ps1 — user-facing messages"

$msg = Get-UnsupportedMessage -Architecture 'Arm64'
Assert-True ($msg -like '*Arm64*') 'the unsupported message names the architecture'
Assert-True ($msg -like '*github.com/smo-key/agent-desktop/releases*') 'the unsupported message links the releases page'

$noAsset = Get-NoAssetMessage -Tag 'v0.2.4'
Assert-True ($noAsset -like '*v0.2.4*') 'the no-asset message names the release'
Assert-True ($noAsset -like '*github.com/smo-key/agent-desktop/releases*') 'the no-asset message links the releases page'

Write-Host "`n----"
Write-Host "Total: $($script:Run) run, $($script:Failed) failed"
if ($script:Failed -gt 0) { exit 1 }
