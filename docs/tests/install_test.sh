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

UM=$(unsupported_message Windows x86_64)
assert_contains "$UM" "Windows"     "unsupported names the OS"
assert_contains "$UM" "coming soon" "unsupported says coming soon"
assert_contains "$UM" "https://github.com/smo-key/agent-desktop/releases" "unsupported links releases page"

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
