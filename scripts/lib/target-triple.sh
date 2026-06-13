#!/usr/bin/env bash
#
# Shared target-triple resolver for the sidecar provisioning scripts
# (fetch-whisper.sh, fetch-llama.sh, validate-sidecars.sh).
#
# This is SOURCED, not executed. It exposes one function, `resolve_target`,
# which derives the Rust target triple, cmake architecture flag, and platform
# executable suffix from the HOST (via `uname -s` / `uname -m`), with an explicit
# `TARGET_TRIPLE` (and/or `TARGET_ARCH`) environment override.
#
# DEFAULT is `aarch64-apple-darwin` when nothing is detected or overridden, so
# existing local Apple-Silicon development is byte-for-byte unchanged.
#
# Supported mappings (see openspec add-desktop-release-ci design decision #4):
#   Darwin + arm64          -> aarch64-apple-darwin       cmake osx-arch arm64
#   Darwin + x86_64         -> x86_64-apple-darwin        cmake osx-arch x86_64
#   Linux  + x86_64         -> x86_64-unknown-linux-gnu   (no osx-arch flag)
#   Linux  + aarch64/arm64  -> aarch64-unknown-linux-gnu  (no osx-arch flag)
#   MINGW/MSYS + x86_64     -> x86_64-pc-windows-msvc     MSVC generator, .exe
#
# After calling `resolve_target`, the following variables are set:
#   TARGET_TRIPLE   the resolved Rust target triple
#   TARGET_OS       one of: darwin | linux | windows  (derived from the triple)
#   OSX_ARCH        the value for -DCMAKE_OSX_ARCHITECTURES, or "" when N/A
#   EXE_SUFFIX      ".exe" on Windows, otherwise ""
#   EXPECT_FORMAT   human-readable expected `file` format substring (for validation)

# Map a Rust target triple -> derived OS / cmake-arch / exe-suffix metadata.
# Sets TARGET_OS, OSX_ARCH, EXE_SUFFIX, EXPECT_FORMAT for the given triple.
# Returns non-zero (with a message on stderr) for an unsupported triple.
_triple_metadata() {
  local triple="$1"
  case "$triple" in
    aarch64-apple-darwin)
      TARGET_OS="darwin"; OSX_ARCH="arm64";  EXE_SUFFIX="";     EXPECT_FORMAT="Mach-O*arm64" ;;
    x86_64-apple-darwin)
      TARGET_OS="darwin"; OSX_ARCH="x86_64"; EXE_SUFFIX="";     EXPECT_FORMAT="Mach-O*x86_64" ;;
    x86_64-unknown-linux-gnu)
      TARGET_OS="linux";  OSX_ARCH="";       EXE_SUFFIX="";     EXPECT_FORMAT="ELF*x86-64" ;;
    aarch64-unknown-linux-gnu)
      TARGET_OS="linux";  OSX_ARCH="";       EXE_SUFFIX="";     EXPECT_FORMAT="ELF*aarch64" ;;
    x86_64-pc-windows-msvc)
      TARGET_OS="windows"; OSX_ARCH="";      EXE_SUFFIX=".exe"; EXPECT_FORMAT="PE32+*Windows" ;;
    *)
      echo "ERROR: unsupported target triple '$triple'." >&2
      echo "  Supported: aarch64-apple-darwin, x86_64-apple-darwin," >&2
      echo "  x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu, x86_64-pc-windows-msvc." >&2
      return 1 ;;
  esac
  return 0
}

# Detect the host's Rust target triple from `uname`. Falls back to the
# Apple-Silicon default for anything unrecognized so local dev is unchanged.
_detect_host_triple() {
  local host_os host_arch
  host_os="$(uname -s)"
  host_arch="${TARGET_ARCH:-$(uname -m)}"
  case "$host_os" in
    Darwin)
      case "$host_arch" in
        arm64|aarch64) echo "aarch64-apple-darwin" ;;
        x86_64|amd64)  echo "x86_64-apple-darwin" ;;
        *)             echo "aarch64-apple-darwin" ;;  # default: Apple Silicon
      esac ;;
    Linux)
      case "$host_arch" in
        x86_64|amd64)  echo "x86_64-unknown-linux-gnu" ;;
        aarch64|arm64) echo "aarch64-unknown-linux-gnu" ;;
        *)             echo "aarch64-apple-darwin" ;;  # default: Apple Silicon
      esac ;;
    MINGW*|MSYS*|CYGWIN*)
      # Git Bash / MSYS on Windows. Only x86_64 MSVC is supported today.
      echo "x86_64-pc-windows-msvc" ;;
    *)
      echo "aarch64-apple-darwin" ;;  # default: Apple Silicon
  esac
}

# Resolve the effective target. Honors the TARGET_TRIPLE override if set,
# otherwise detects from the host. Populates the exported variables documented
# above, or exits non-zero on an unsupported override.
resolve_target() {
  if [[ -n "${TARGET_TRIPLE:-}" ]]; then
    : # explicit override wins
  else
    TARGET_TRIPLE="$(_detect_host_triple)"
  fi
  _triple_metadata "$TARGET_TRIPLE" || return 1
}
