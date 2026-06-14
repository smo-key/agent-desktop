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

# --- configuration ----------------------------------------------------------

GITHUB_REPO="smo-key/agent-desktop"
RELEASES_PAGE="https://github.com/$GITHUB_REPO/releases"
API_LATEST="https://api.github.com/repos/$GITHUB_REPO/releases/latest"
APP_NAME="Agent Desktop"

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

# resolve_asset KEY JSON_FILE -> "<url>\t<digest>" for the platform's installer.
resolve_asset() {
  suffix=$(asset_suffix "$1") || return 1
  url=$(asset_url "$2" "$suffix") || return 1
  digest=$(asset_digest "$2" "$suffix") || return 1
  printf '%s\t%s\n' "$url" "$digest"
}

# desktop_entry_content EXEC_PATH -> a freedesktop .desktop launcher body.
desktop_entry_content() {
  cat <<EOF
[Desktop Entry]
Type=Application
Name=$APP_NAME
Exec=$1
Terminal=false
Categories=Development;Utility;
EOF
}

# unsupported_message OS ARCH -> friendly text for platforms with no installer.
unsupported_message() {
  printf 'Agent Desktop has no installer for %s/%s yet.\n' "$1" "$2"
  printf 'Windows and Intel-Mac builds are coming soon.\n'
  printf 'Browse all downloads: %s\n' "$RELEASES_PAGE"
}

# --- side effects -----------------------------------------------------------

_uname_s() { echo "${AGENT_DESKTOP_OS:-$(uname -s)}"; }
_uname_m() { echo "${AGENT_DESKTOP_ARCH:-$(uname -m)}"; }

log() { printf '%s\n' "$*"; }
err() { printf '%s\n' "$*" >&2; }

# fetch_latest_json DEST -> download the latest-release metadata (quiet).
fetch_latest_json() {
  curl -fsSL --proto '=https' --tlsv1.2 -o "$1" "$API_LATEST"
}

# download_file URL DEST -> download a release asset (with a progress bar).
download_file() {
  curl -fSL -# --proto '=https' --tlsv1.2 -o "$2" "$1"
}

# install_macos DMG_PATH -> mount, copy the app into place, clear quarantine.
# Sets INSTALLED_PATH on success.
install_macos() {
  mnt=$(mktemp -d)
  log "→ mounting disk image…"
  hdiutil attach -nobrowse -quiet -mountpoint "$mnt" "$1"
  src="$mnt/$APP_NAME.app"
  [ -d "$src" ] || src=$(find "$mnt" -maxdepth 1 -name '*.app' -type d | head -n1)

  dest_dir="/Applications"
  [ -w "$dest_dir" ] || dest_dir="$HOME/Applications"
  mkdir -p "$dest_dir"

  log "→ installing to $dest_dir…"
  rm -rf "$dest_dir/$APP_NAME.app"
  cp -R "$src" "$dest_dir/$APP_NAME.app"
  hdiutil detach -quiet "$mnt" >/dev/null 2>&1 || true

  # Best-effort: clear the download quarantine so the first launch isn't blocked.
  xattr -dr com.apple.quarantine "$dest_dir/$APP_NAME.app" 2>/dev/null || true
  INSTALLED_PATH="$dest_dir/$APP_NAME.app"
}

# install_linux APPIMAGE_PATH -> place AppImage + register a launcher entry.
# Sets INSTALLED_PATH on success.
install_linux() {
  bindir="$HOME/.local/bin"
  appsdir="$HOME/.local/share/applications"
  mkdir -p "$bindir" "$appsdir"
  dest="$bindir/agent-desktop.AppImage"

  log "→ installing to $dest…"
  cp "$1" "$dest"
  chmod +x "$dest"
  desktop_entry_content "$dest" > "$appsdir/agent-desktop.desktop"
  INSTALLED_PATH="$dest"
}

# launch_app PATH OS -> open the freshly installed app.
launch_app() {
  case "$2" in
    Darwin) open -a "$1" >/dev/null 2>&1 || true ;;
    Linux) ( "$1" >/dev/null 2>&1 & ) || true ;;
  esac
}

# --- entry point ------------------------------------------------------------

main() {
  os=$(_uname_s)
  arch=$(_uname_m)
  key=$(platform_key "$os" "$arch") || {
    unsupported_message "$os" "$arch" >&2
    return 1
  }

  command -v curl >/dev/null 2>&1 || { err "curl is required but not installed."; return 1; }

  log "Agent Desktop installer"
  log "→ platform: $os $arch"

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT INT TERM

  json="$tmp/latest.json"
  log "→ checking the latest release…"
  fetch_latest_json "$json" || { err "Could not reach GitHub — check your connection."; return 1; }

  resolved=$(resolve_asset "$key" "$json") || {
    err "No installer for $os/$arch in the latest release. See $RELEASES_PAGE"
    return 1
  }
  url=$(printf '%s' "$resolved" | cut -f1)
  digest=$(printf '%s' "$resolved" | cut -f2)

  file="$tmp/$(basename "$url")"
  log "→ downloading $(basename "$url")…"
  download_file "$url" "$file" || { err "Download failed."; return 1; }

  log "→ verifying checksum…"
  verify_sha256 "$file" "$digest" || {
    err "Checksum verification failed — refusing to install."
    return 1
  }

  INSTALLED_PATH=""
  case "$key" in
    macos-arm64) install_macos "$file" ;;
    linux-*) install_linux "$file" ;;
  esac

  log "✓ Installed: $INSTALLED_PATH"

  if is_interactive && confirm "Launch $APP_NAME now? [Y/n]" yes; then
    launch_app "$INSTALLED_PATH" "$os"
  fi
}

# Run main only when executed directly, not when sourced for tests.
if [ "${AGENT_DESKTOP_INSTALL_LIB:-}" != "1" ]; then
  main "$@"
fi
