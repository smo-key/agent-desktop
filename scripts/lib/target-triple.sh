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
#   EXPECT_FORMAT   human-readable expected `file` format (for messages only)
#   EXPECT_RE       an ERE (grep -E) that asserts BOTH the binary format AND the
#                   architecture of a provisioned sidecar (used for validation)

# Map a Rust target triple -> derived OS / cmake-arch / exe-suffix metadata.
# Sets TARGET_OS, OSX_ARCH, EXE_SUFFIX, EXPECT_FORMAT, EXPECT_RE for the triple.
# Returns non-zero (with a message on stderr) for an unsupported triple.
#
# EXPECT_RE is a real extended regex (not a glob): it must assert the arch so a
# wrong-arch binary is REJECTED. Note `PE32\+` escapes the literal '+' (which is
# a quantifier in ERE) and requires x86-64 so a 32-bit or ARM64 Windows PE fails.
# The patterns must be ORDER-INDEPENDENT w.r.t. how `file` emits its fields: the
# Windows runner's `file` prints "PE32+ executable for MS Windows 6.00 (console),
# x86-64, ..." — i.e. "MS Windows" BEFORE the arch — so the Windows RE asserts
# only `PE32\+ ... x86-64` (PE32+ already implies a Windows PE; tacking on
# `.*Windows` would require arch-before-Windows and spuriously fail).
# shellcheck disable=SC2034  # these are consumed by the scripts that source this
_triple_metadata() {
  local triple="$1"
  case "$triple" in
    aarch64-apple-darwin)
      TARGET_OS="darwin"; OSX_ARCH="arm64";  EXE_SUFFIX="";     EXPECT_FORMAT="Mach-O arm64";  EXPECT_RE="Mach-O.*arm64" ;;
    x86_64-apple-darwin)
      TARGET_OS="darwin"; OSX_ARCH="x86_64"; EXE_SUFFIX="";     EXPECT_FORMAT="Mach-O x86_64"; EXPECT_RE="Mach-O.*x86_64" ;;
    x86_64-unknown-linux-gnu)
      TARGET_OS="linux";  OSX_ARCH="";       EXE_SUFFIX="";     EXPECT_FORMAT="ELF x86-64";    EXPECT_RE="ELF.*(x86-64|x86_64)" ;;
    aarch64-unknown-linux-gnu)
      TARGET_OS="linux";  OSX_ARCH="";       EXE_SUFFIX="";     EXPECT_FORMAT="ELF aarch64";   EXPECT_RE="ELF.*(aarch64|ARM aarch64)" ;;
    x86_64-pc-windows-msvc)
      TARGET_OS="windows"; OSX_ARCH="";      EXE_SUFFIX=".exe"; EXPECT_FORMAT="PE32+ x86-64 (MS Windows)"; EXPECT_RE="PE32\\+.*(x86-64|x86_64)" ;;
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
        # A detected Linux host with an unknown arch must NOT cross-wire to the
        # Darwin default (that would build with macOS cmake flags on Linux).
        # Emit a Linux triple so _triple_metadata rejects it with a clear error.
        *)             echo "${host_arch}-unknown-linux-gnu" ;;
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
