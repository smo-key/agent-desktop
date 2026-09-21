# Unit tests for docs/install.sh pure logic.
# Sourced by run.sh with lib.sh already loaded and $HERE set.

# Load the installer as a library (defines functions, does not run main).
AGENT_DESKTOP_INSTALL_LIB=1
export AGENT_DESKTOP_INSTALL_LIB
# shellcheck disable=SC1090
. "$HERE/../install.sh"
# install.sh enables `set -eu`; relax it here so intentional non-zero assertions
# don't abort the test file.
set +eu

# --- platform_key OS ARCH -> platform key (or non-zero for unsupported) ---

assert_eq "$(platform_key Darwin arm64)"   "macos-arm64" "macOS arm64 -> macos-arm64"
assert_eq "$(platform_key Linux x86_64)"   "linux-x64"   "Linux x86_64 -> linux-x64"
assert_eq "$(platform_key Linux aarch64)"  "linux-arm64" "Linux aarch64 -> linux-arm64"

assert_fail "Intel Mac is unsupported"     -- platform_key Darwin x86_64
assert_fail "Windows is unsupported"       -- platform_key MINGW64_NT x86_64
assert_fail "Unknown arch is unsupported"  -- platform_key Linux riscv64

# --- asset_suffix KEY -> trailing asset-name pattern for that platform ---

assert_eq "$(asset_suffix macos-arm64)" "_aarch64.dmg"      "macos-arm64 -> dmg suffix"
assert_eq "$(asset_suffix linux-x64)"   "_amd64.AppImage"   "linux-x64 -> amd64 AppImage suffix"
assert_eq "$(asset_suffix linux-arm64)" "_aarch64.AppImage" "linux-arm64 -> aarch64 AppImage suffix"

assert_fail "unknown key has no suffix"  -- asset_suffix bogus-key

# --- asset_url / asset_digest JSON_FILE SUFFIX (jq-free) ---

FIX="$HERE/fixtures-latest.json"
DMG_URL="https://github.com/smo-key/agent-desktop/releases/download/v0.2.0/Agent.Desktop_0.2.0_aarch64.dmg"
DMG_DIGEST="sha256:ff74fd7ffd77b91276e17b891f739270c206c2ffc62f2e6e5b997f33ccbe7907"
APP_URL="https://github.com/smo-key/agent-desktop/releases/download/v0.2.0/Agent.Desktop_0.2.0_amd64.AppImage"
APP_DIGEST="sha256:9eac8a70392df9b039808f6c17cbdf8df2720059287589f4169b6dd9e76d1926"

assert_eq "$(asset_url "$FIX" _aarch64.dmg)"       "$DMG_URL"    "asset_url finds the dmg"
assert_eq "$(asset_url "$FIX" _amd64.AppImage)"    "$APP_URL"    "asset_url finds the amd64 AppImage (not .sig)"
assert_eq "$(asset_digest "$FIX" _aarch64.dmg)"    "$DMG_DIGEST" "asset_digest finds the dmg digest"
assert_eq "$(asset_digest "$FIX" _amd64.AppImage)" "$APP_DIGEST" "asset_digest finds the AppImage digest"

assert_fail "asset_url returns non-zero when absent" -- asset_url "$FIX" _no_such.suffix

# --- verify_sha256 FILE EXPECTED_DIGEST ---
# sha256("hello") with no trailing newline is the well-known value below.
SHA_TMP=$(mktemp)
printf 'hello' > "$SHA_TMP"
HELLO="sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
HELLO_UP="sha256:2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824"
HELLO_BARE="2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
WRONG="sha256:0000000000000000000000000000000000000000000000000000000000000000"

assert_ok   "verify matches digest"           -- verify_sha256 "$SHA_TMP" "$HELLO"
assert_ok   "verify is case-insensitive"      -- verify_sha256 "$SHA_TMP" "$HELLO_UP"
assert_ok   "verify accepts bare hex"         -- verify_sha256 "$SHA_TMP" "$HELLO_BARE"
assert_fail "verify rejects wrong digest"     -- verify_sha256 "$SHA_TMP" "$WRONG"
rm -f "$SHA_TMP"

# --- _yesno_default ANSWER DEFAULT -> exit 0 for yes, 1 for no ---

assert_ok   "y means yes"                 -- _yesno_default y no
assert_ok   "uppercase Y means yes"       -- _yesno_default Y no
assert_ok   "yes means yes"               -- _yesno_default yes no
assert_fail "n means no"                  -- _yesno_default n yes
assert_fail "garbage means no"            -- _yesno_default wat no
assert_ok   "empty + default yes -> yes"  -- _yesno_default "" yes
assert_fail "empty + default no  -> no"   -- _yesno_default "" no

# --- resolve_asset KEY JSON_FILE -> "url<TAB>digest" ---

assert_eq "$(resolve_asset linux-x64 "$FIX")" \
  "$(printf '%s\t%s' "$APP_URL" "$APP_DIGEST")" "resolve_asset returns url + digest"
assert_fail "resolve_asset fails on bad key"     -- resolve_asset bogus-key "$FIX"
assert_fail "resolve_asset fails when no asset"  -- resolve_asset macos-arm64 /dev/null

# --- desktop_entry_content EXEC_PATH -> .desktop body ---

DEC=$(desktop_entry_content "/home/u/Agent Desktop.AppImage")
assert_eq "$(printf '%s\n' "$DEC" | grep '^Exec=')" "Exec=/home/u/Agent Desktop.AppImage" "desktop Exec line"
assert_eq "$(printf '%s\n' "$DEC" | grep '^Type=')" "Type=Application"                     "desktop Type line"
assert_eq "$(printf '%s\n' "$DEC" | grep '^Name=')" "Name=Agent Desktop"                   "desktop Name line"
assert_contains "$DEC" "Terminal=false" "desktop entry is not a terminal app"

# --- unsupported_message OS ARCH -> friendly text ---

# A still-unsupported NON-Windows platform keeps the original message.
UM=$(unsupported_message Darwin x86_64)
assert_contains "$UM" "Darwin"      "unsupported names the OS"
assert_contains "$UM" "coming soon" "unsupported says coming soon"
assert_contains "$UM" "https://github.com/smo-key/agent-desktop/releases" "unsupported links releases page"

# --- Windows is redirected to the PowerShell installer, not "coming soon" ---

# Git Bash / MSYS / Cygwin DO have a POSIX shell, so this script runs there —
# but the only asset it could install is a macOS/Linux one. Point at install.ps1.
assert_ok "MINGW is a Windows uname"   -- is_windows_uname MINGW64_NT-10.0-22631
assert_ok "MSYS is a Windows uname"    -- is_windows_uname MSYS_NT-10.0
assert_ok "CYGWIN is a Windows uname"  -- is_windows_uname CYGWIN_NT-10.0
assert_fail "Darwin is not Windows"    -- is_windows_uname Darwin
assert_fail "Linux is not Windows"     -- is_windows_uname Linux

WM=$(unsupported_message MINGW64_NT-10.0-22631 x86_64)
assert_contains "$WM" "PowerShell" "Windows message names PowerShell"
assert_contains "$WM" "https://smo-key.github.io/agent-desktop/install.ps1" "Windows message gives the ps1 URL"
assert_contains "$WM" "irm" "Windows message shows the one-liner"
# It must NOT tell a Windows user support is coming soon — it is here.
case "$WM" in
  *"coming soon"*) WM_SOON=yes ;;
  *) WM_SOON=no ;;
esac
assert_eq "$WM_SOON" "no" "Windows message does not say coming soon"

# --- main on an unsupported platform exits non-zero without installing ---

TESTS_RUN=$((TESTS_RUN + 1))
if AGENT_DESKTOP_OS=MINGW64_NT AGENT_DESKTOP_ARCH=x86_64 main >/dev/null 2>&1; then
  TESTS_FAILED=$((TESTS_FAILED + 1))
  printf '  FAIL main exits non-zero on unsupported platform\n'
else
  printf '  ok   main exits non-zero on unsupported platform\n'
fi

# --- parser robustness (adversarial-review regressions) ---

mkjson() { _f=$(mktemp); cat > "$_f"; printf '%s' "$_f"; }

# A `"digest": null` must NOT be accepted as a (whitespace) digest.
NULLJSON=$(mkjson <<'JSON'
{
  "assets": [
    {
      "url": "https://api.github.com/x/1",
      "name": "Agent.Desktop_0.2.0_amd64.AppImage",
      "digest": null,
      "browser_download_url": "https://dl/Agent.Desktop_0.2.0_amd64.AppImage"
    }
  ]
}
JSON
)
assert_fail "null digest is rejected"             -- asset_digest "$NULLJSON" _amd64.AppImage
assert_eq   "$(asset_url "$NULLJSON" _amd64.AppImage)" \
            "https://dl/Agent.Desktop_0.2.0_amd64.AppImage" "url still resolves with null digest"

# A matching asset that lacks a digest must NOT inherit the previous asset's.
BLEEDJSON=$(mkjson <<'JSON'
{
  "assets": [
    {
      "name": "Agent.Desktop_0.2.0_amd64.deb",
      "digest": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      "browser_download_url": "https://dl/Agent.Desktop_0.2.0_amd64.deb"
    },
    {
      "name": "Agent.Desktop_0.2.0_amd64.AppImage",
      "browser_download_url": "https://dl/Agent.Desktop_0.2.0_amd64.AppImage"
    }
  ]
}
JSON
)
assert_fail "missing digest does not bind a neighbour's" -- asset_digest "$BLEEDJSON" _amd64.AppImage

# The matching asset's OWN digest is bound even when another asset precedes it.
TWOJSON=$(mkjson <<'JSON'
{
  "assets": [
    {
      "name": "Agent.Desktop_0.2.0_amd64.deb",
      "digest": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      "browser_download_url": "https://dl/Agent.Desktop_0.2.0_amd64.deb"
    },
    {
      "name": "Agent.Desktop_0.2.0_amd64.AppImage",
      "digest": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      "browser_download_url": "https://dl/Agent.Desktop_0.2.0_amd64.AppImage"
    }
  ]
}
JSON
)
assert_eq "$(asset_digest "$TWOJSON" _amd64.AppImage)" \
  "sha256:2222222222222222222222222222222222222222222222222222222222222222" \
  "binds the matching asset's own digest"

# Digest is found regardless of field order within the asset object.
FLIPJSON=$(mkjson <<'JSON'
{
  "assets": [
    {
      "name": "Agent.Desktop_0.2.0_amd64.AppImage",
      "browser_download_url": "https://dl/Agent.Desktop_0.2.0_amd64.AppImage",
      "digest": "sha256:3333333333333333333333333333333333333333333333333333333333333333"
    }
  ]
}
JSON
)
assert_eq "$(asset_digest "$FLIPJSON" _amd64.AppImage)" \
  "sha256:3333333333333333333333333333333333333333333333333333333333333333" \
  "digest found regardless of field order"

# A malformed (non sha256:hex) digest is rejected.
BADJSON=$(mkjson <<'JSON'
{
  "assets": [
    {
      "name": "Agent.Desktop_0.2.0_amd64.AppImage",
      "digest": "sha256:nothex",
      "browser_download_url": "https://dl/Agent.Desktop_0.2.0_amd64.AppImage"
    }
  ]
}
JSON
)
assert_fail "malformed digest is rejected" -- asset_digest "$BADJSON" _amd64.AppImage

# verify_sha256 tolerates an uppercase SHA256: algorithm label.
SHA_TMP2=$(mktemp); printf 'hello' > "$SHA_TMP2"
assert_ok "verify accepts uppercase SHA256: label" -- \
  verify_sha256 "$SHA_TMP2" "SHA256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
rm -f "$SHA_TMP2"

# Regression: stock macOS /bin/sh is bash 3.2, whose parameter scanner is not
# multibyte-aware. An UNBRACED "$var" directly followed by a multibyte char (our
# progress lines use … → ✓) folds the leading byte into the name -> unset var ->
# `set -u` aborts. Forbid that adjacency in the script source; braces are safe.
DANGER=$(grep -nE '\$[A-Za-z_][A-Za-z0-9_]*(…|→|✓)' "$HERE/../install.sh" || true)
assert_eq "$DANGER" "" "no unbraced \$var immediately before a multibyte char"

# The LAST asset (no following "name") must not bleed past the assets array and
# bind a digest from a release-level field outside it.
BLEED2JSON=$(mkjson <<'JSON'
{
  "assets": [
    {
      "name": "Agent.Desktop_0.2.0_aarch64.dmg",
      "browser_download_url": "https://dl/Agent.Desktop_0.2.0_aarch64.dmg"
    }
  ],
  "extra": {
    "digest": "sha256:9999999999999999999999999999999999999999999999999999999999999999"
  }
}
JSON
)
assert_fail "last asset does not bind a digest from outside the array" -- asset_digest "$BLEED2JSON" _aarch64.dmg

# is_interactive must check that the tty can actually be OPENED, not just that the
# device node passes a permission test — `/dev/tty` exists but errors with "Device
# not configured" when there is no controlling terminal (CI, piped runs).
assert_ok   "tty_usable on an openable file"   -- _tty_usable /dev/null
assert_fail "tty_usable on a missing device"   -- _tty_usable /no/such/tty-device

# --- parse_channel ARG -> the release train to install ----------------------
#
# The default must stay "stable" for an ABSENT argument: the documented
# `curl … | sh` one-liner passes none, and that path must not change.

assert_eq "$(parse_channel '')"       "stable" "no argument defaults to stable"
assert_eq "$(parse_channel stable)"   "stable" "stable stays stable"
assert_eq "$(parse_channel beta)"     "beta"   "beta selects beta"
assert_eq "$(parse_channel BETA)"     "beta"   "channel is case-insensitive"
assert_eq "$(parse_channel Stable)"   "stable" "stable is case-insensitive too"

# A typo must NOT quietly install stable — that would hand the user a different
# train than the one they asked for, with no indication it happened.
assert_fail "unknown channel is rejected"     -- parse_channel betaa
assert_fail "a flag is not a channel"         -- parse_channel --beta
assert_fail "latest is not a channel name"    -- parse_channel latest

# --- newest_prerelease_tag JSON_FILE -> newest published prerelease tag -----

RELFIX="$HERE/fixtures-releases.json"
STABLEONLY="$HERE/fixtures-releases-stable-only.json"

# The fixture is newest-first, as GitHub returns it:
#   v0.5.0-1  draft prerelease   <- must be skipped
#   v0.3.2    stable             <- must be skipped
#   v0.4.0-2  prerelease         <- the answer
#   v0.4.0-1  prerelease
assert_eq "$(newest_prerelease_tag "$RELFIX")" "v0.4.0-2" "picks the newest published prerelease"

# A failed release run leaves a DRAFT behind carrying partial assets — this repo
# had exactly that for v0.4.0-2. Installing from one would download a
# half-uploaded release, so a draft is skipped even though it is a prerelease.
# Asserted on a fixture whose ONLY prerelease is a draft, so an implementation
# that ignored `draft` would return v0.5.0-1 here instead of failing.
DRAFTONLY="$HERE/fixtures-releases-draft-only.json"
assert_fail "a draft-only list yields no installable prerelease" -- newest_prerelease_tag "$DRAFTONLY"

# Nothing to install is a real state (before the first beta ships), and must be
# reported rather than silently falling back to a stable build.
assert_fail "no prerelease in the list is an error" -- newest_prerelease_tag "$STABLEONLY"

# --- channel_hint CHANNEL -> closing guidance -------------------------------
#
# Installing a beta BUILD does not put the app on the beta CHANNEL: the channel
# is a separate in-app preference. Without this the user gets one beta and then
# never hears about another, with no clue why.
assert_contains "$(channel_hint beta)" "Settings" "beta install names the Settings location"
assert_contains "$(channel_hint beta)" "Beta"     "beta install names the Beta setting"
assert_eq       "$(channel_hint stable)" ""       "stable install prints no extra guidance"

# --- main rejects an unknown channel before touching the network ------------
#
# The platform here is SUPPORTED, so the only reason to exit is the bad channel.
#
# Every side effect is stubbed FIRST, and the stubs record that they ran. That
# is not belt-and-braces: written without them, this test made `main` run the
# whole stable path for real and copy an app into /Applications. A unit test
# must never be able to install software, and asserting the stubs stayed
# untouched is also the actual claim being made — that a typo fails before any
# network call, so it reports "unknown channel" rather than "could not reach
# GitHub" on a machine that is simply offline.
SIDE_EFFECTS="$HERE/../../.tmp-install-test-side-effects"
rm -f "$SIDE_EFFECTS"
fetch_latest_json() { echo "fetch_latest_json" >> "$SIDE_EFFECTS"; return 1; }
fetch_releases_json() { echo "fetch_releases_json" >> "$SIDE_EFFECTS"; return 1; }
fetch_release_by_tag() { echo "fetch_release_by_tag" >> "$SIDE_EFFECTS"; return 1; }
download_file() { echo "download_file" >> "$SIDE_EFFECTS"; return 1; }
install_macos() { echo "install_macos" >> "$SIDE_EFFECTS"; return 1; }
install_linux() { echo "install_linux" >> "$SIDE_EFFECTS"; return 1; }
launch_app() { echo "launch_app" >> "$SIDE_EFFECTS"; return 1; }

TESTS_RUN=$((TESTS_RUN + 1))
CHANNEL_ERR=$(AGENT_DESKTOP_OS=Darwin AGENT_DESKTOP_ARCH=arm64 main nightly 2>&1 >/dev/null) && CHANNEL_RC=0 || CHANNEL_RC=1
case "$CHANNEL_RC:$CHANNEL_ERR" in
  1:*[Uu]nknown*channel*)
    printf '  ok   main rejects an unknown channel\n' ;;
  *)
    TESTS_FAILED=$((TESTS_FAILED + 1))
    printf '  FAIL main rejects an unknown channel\n       rc=%s err=[%s]\n' "$CHANNEL_RC" "$CHANNEL_ERR" ;;
esac

assert_eq "$(cat "$SIDE_EFFECTS" 2>/dev/null || true)" "" "a bad channel touches nothing: no fetch, no download, no install"
rm -f "$SIDE_EFFECTS"

# --- main on the beta channel resolves the newest prerelease ----------------
#
# Every network call and install step is stubbed: the fetchers serve the local
# fixtures, so this exercises the WIRING (which endpoint is consulted, which tag
# is chosen, which release JSON is then read) with no network and nothing
# written outside the temp dir.
BETA_LOG="$HERE/../../.tmp-install-test-beta"
rm -f "$BETA_LOG"
fetch_latest_json() { echo "USED-LATEST-ENDPOINT" >> "$BETA_LOG"; cp "$HERE/fixtures-latest.json" "$1"; }
fetch_releases_json() { echo "list" >> "$BETA_LOG"; cp "$HERE/fixtures-releases.json" "$1"; }
fetch_release_by_tag() { echo "tag=$1" >> "$BETA_LOG"; cp "$HERE/fixtures-latest.json" "$2"; }
download_file() { echo "download=$1" >> "$BETA_LOG"; : > "$2"; }
verify_sha256() { return 0; }
install_macos() { INSTALLED_PATH="/tmp/stub.app"; }
launch_app() { :; }

AGENT_DESKTOP_OS=Darwin AGENT_DESKTOP_ARCH=arm64 main beta >/dev/null 2>&1 || true
BETA_TRACE=$(cat "$BETA_LOG" 2>/dev/null || true)

# The beta lane must consult the LIST endpoint and then the chosen TAG. Using
# releases/latest would silently install a stable build for a user who typed
# `beta` — the exact bug this whole change exists to prevent.
assert_contains "$BETA_TRACE" "tag=v0.4.0-2" "beta fetches the newest prerelease by tag"
case "$BETA_TRACE" in
  *USED-LATEST-ENDPOINT*)
    TESTS_RUN=$((TESTS_RUN + 1)); TESTS_FAILED=$((TESTS_FAILED + 1))
    printf '  FAIL beta never consults the stable releases/latest endpoint\n' ;;
  *)
    TESTS_RUN=$((TESTS_RUN + 1))
    printf '  ok   beta never consults the stable releases/latest endpoint\n' ;;
esac
rm -f "$BETA_LOG"
