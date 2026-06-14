#!/bin/sh
# Agent Desktop installer.
#
# Usage:
#   curl -fsSL https://smo-key.github.io/agent-desktop/install.sh | sh
#
# What it does: detects your OS/CPU, downloads the matching latest release from
# GitHub, verifies its sha256, and installs a ready-to-run app. It needs no
# special tools (no jq, no Homebrew) and never runs sudo without telling you.
# It is short on purpose so you can read it before piping it into a shell.
#
# Supported today: macOS (Apple Silicon), Linux (x86_64 / arm64).
# Windows and Intel Macs are coming soon.
set -eu

# --- pure logic (unit-tested via docs/tests) --------------------------------

# platform_key OS ARCH -> echoes a platform key, or returns 1 if unsupported.
platform_key() {
  case "$1:$2" in
    Darwin:arm64) echo "macos-arm64" ;;
    Linux:x86_64) echo "linux-x64" ;;
    Linux:aarch64) echo "linux-arm64" ;;
    *) return 1 ;;
  esac
}

# asset_suffix KEY -> echoes the trailing asset-name pattern, or returns 1.
asset_suffix() {
  case "$1" in
    macos-arm64) echo "_aarch64.dmg" ;;
    linux-x64) echo "_amd64.AppImage" ;;
    linux-arm64) echo "_aarch64.AppImage" ;;
    *) return 1 ;;
  esac
}

# _re_escape STR -> STR with basic-regex metacharacters backslash-escaped.
_re_escape() {
  printf '%s' "$1" | sed 's/[][\.*^$]/\\&/g'
}

# asset_url JSON_FILE SUFFIX -> browser_download_url whose name ends with SUFFIX.
# Anchoring on the URL tail (suffix at end of line) skips the ".sig" siblings.
asset_url() {
  url=$(
    grep '"browser_download_url"' "$1" \
      | sed 's/.*"browser_download_url": *"//; s/".*//' \
      | grep -- "$(_re_escape "$2")\$" \
      | head -n1
  )
  [ -n "$url" ] || return 1
  printf '%s\n' "$url"
}

# asset_digest JSON_FILE SUFFIX -> the "sha256:..." digest for that asset.
# In the GitHub payload each asset lists "digest" before "browser_download_url",
# so the last digest seen before the matching URL belongs to that asset.
asset_digest() {
  out=$(
    awk -v suf="$2" '
      /"digest":/ {
        d = $0; sub(/.*"digest": *"/, "", d); sub(/".*/, "", d)
      }
      /"browser_download_url":/ {
        u = $0; sub(/.*"browser_download_url": *"/, "", u); sub(/".*/, "", u)
        if (length(u) >= length(suf) &&
            substr(u, length(u) - length(suf) + 1) == suf) { print d; exit }
      }
    ' "$1"
  )
  [ -n "$out" ] || return 1
  printf '%s\n' "$out"
}

# _sha256_of FILE -> lowercase hex sha256, or returns 2 if no tool is available.
_sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    return 2
  fi
}

# verify_sha256 FILE EXPECTED -> 0 if the file's sha256 matches EXPECTED.
# EXPECTED may be bare hex or "sha256:<hex>"; comparison is case-insensitive.
verify_sha256() {
  expected=$(printf '%s' "$2" | sed 's/^sha256://' | tr 'A-Z' 'a-z')
  actual=$(_sha256_of "$1" | tr 'A-Z' 'a-z')
  [ -n "$actual" ] || return 2
  [ "$actual" = "$expected" ]
}

# _yesno_default ANSWER DEFAULT -> exit 0 (yes) or 1 (no).
# Empty ANSWER falls back to DEFAULT ("yes"/"no"); anything not starting with
# y/Y counts as no.
_yesno_default() {
  ans=$1
  [ -n "$ans" ] || ans=$2
  case "$ans" in
    y* | Y*) return 0 ;;
    *) return 1 ;;
  esac
}

# is_interactive -> 0 when a controlling terminal is available.
is_interactive() {
  [ -r /dev/tty ] && [ -w /dev/tty ]
}

# confirm PROMPT DEFAULT -> ask on the terminal (not piped stdin) and return the
# answer. With no terminal, returns DEFAULT without prompting.
confirm() {
  if is_interactive; then
    printf '%s ' "$1" > /dev/tty
    IFS= read -r reply < /dev/tty || reply=""
    _yesno_default "$reply" "$2"
  else
    _yesno_default "" "$2"
  fi
}

# --- entry point ------------------------------------------------------------

main() {
  echo "Agent Desktop installer is not implemented yet."
  return 1
}

# Run main only when executed directly, not when sourced for tests.
if [ "${AGENT_DESKTOP_INSTALL_LIB:-}" != "1" ]; then
  main "$@"
fi
