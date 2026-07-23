#!/usr/bin/env bash
#
# Type-check `src-tauri` for Windows x64 (`x86_64-pc-windows-msvc`) from macOS or
# Linux, so a Windows-breaking change is caught in seconds instead of waiting on
# the CI Windows leg.
#
# `cargo check` does not LINK, so this needs no MSVC linker and no Windows SDK
# libraries — only the target's std and the MSVC CRT *headers* (for the C code in
# `ring`). It proves compilation, NOT that the app runs; only a real Windows
# machine can do that.
#
# Prerequisites (one-time):
#
#   1. A rustup-managed toolchain with the Windows target:
#          brew install rustup            # macOS; provides `rustup` directly
#          rustup toolchain install stable --profile minimal
#          rustup target add x86_64-pc-windows-msvc --toolchain stable
#
#      NOTE: if you also have Homebrew's `rust` formula, it owns
#      /opt/homebrew/bin/{cargo,rustc} and its sysroot has NO Windows std. A bare
#      `cargo check --target x86_64-pc-windows-msvc` then fails with a confusing
#      "can't find crate for `core`". This script pins RUSTC to the rustup
#      toolchain and puts its bin dir first on PATH, so both can coexist.
#
#   2. cargo-xwin, which supplies the MSVC CRT headers `ring` needs:
#          cargo install cargo-xwin --locked
#      Its first run downloads Microsoft's SDK/CRT and requires accepting
#      Microsoft's license (XWIN_ACCEPT_LICENSE=1, set below).
#
# Usage:
#     ./scripts/check-windows.sh                 # check the lib
#     ./scripts/check-windows.sh --all-targets   # include tests/benches
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="x86_64-pc-windows-msvc"

# Locate the rustup toolchain that owns the Windows target. Prefer an explicit
# RUSTUP_TOOLCHAIN_DIR, else the host-triple default under ~/.rustup.
host_triple="$(rustc -vV 2>/dev/null | awk '/^host:/ {print $2}')"
TC="${RUSTUP_TOOLCHAIN_DIR:-$HOME/.rustup/toolchains/stable-${host_triple}}"

if [[ ! -x "$TC/bin/cargo" ]]; then
  echo "ERROR: no rustup toolchain at $TC" >&2
  echo "  Install one:  rustup toolchain install stable --profile minimal" >&2
  echo "  Then the target:  rustup target add $TARGET --toolchain stable" >&2
  exit 1
fi

if [[ ! -d "$TC/lib/rustlib/$TARGET" ]]; then
  echo "ERROR: the $TARGET std is not installed for $TC" >&2
  echo "  Install it:  rustup target add $TARGET --toolchain stable" >&2
  exit 1
fi

if ! command -v cargo-xwin >/dev/null 2>&1; then
  echo "ERROR: cargo-xwin is required (it supplies the MSVC CRT headers that" >&2
  echo "  ring's C build needs; without it the check fails on a missing assert.h)." >&2
  echo "  Install it:  cargo install cargo-xwin --locked" >&2
  exit 1
fi

# Pin BOTH the toolchain bin dir and RUSTC — cargo otherwise resolves `rustc`
# from PATH, which may be a different (Homebrew) rustc with no Windows std.
export PATH="$TC/bin:$PATH"
export RUSTC="$TC/bin/rustc"
export XWIN_ACCEPT_LICENSE="${XWIN_ACCEPT_LICENSE:-1}"

# tauri-build refuses to run unless every `externalBin` and bundled resource
# EXISTS. None of their bytes affect type-checking, and building the real
# sidecars takes ~20 minutes, so stub any that are missing. `src-tauri/binaries`
# and the model are gitignored, so these are never committed.
mkdir -p "$ROOT_DIR/src-tauri/binaries" "$ROOT_DIR/src-tauri/models"
for name in whisper-cli whisper-server llama-server; do
  stub="$ROOT_DIR/src-tauri/binaries/${name}-${TARGET}.exe"
  [[ -e "$stub" ]] || printf 'MZ' >"$stub"
done
[[ -e "$ROOT_DIR/src-tauri/models/ggml-tiny.bin" ]] || : >"$ROOT_DIR/src-tauri/models/ggml-tiny.bin"

echo "→ cargo xwin check --target $TARGET ${*:-}"
cd "$ROOT_DIR/src-tauri"
exec cargo xwin check --target "$TARGET" "$@"
