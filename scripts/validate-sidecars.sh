#!/usr/bin/env bash
#
# Validate the provisioned sidecar binaries for a target before bundling.
#
# Given a target triple (positional arg, or `TARGET_TRIPLE` env, default = host),
# this checks that each expected sidecar — `whisper-cli`, `whisper-server`,
# `llama-server` — exists under src-tauri/binaries/, is executable, and matches
# the expected binary FORMAT + ARCH for that triple (via the `file` command):
#
#     *-apple-darwin   -> Mach-O arm64 / x86_64
#     *-linux-gnu      -> ELF aarch64 / x86-64
#     *-windows-msvc   -> PE32+ / MS Windows
#
# Exits NON-ZERO with a clear message on the first missing / non-executable /
# format-mismatched sidecar, so CI fails the build for that target rather than
# bundling the wrong binary.
#
# Usage:
#     ./scripts/validate-sidecars.sh                       # validate host target
#     ./scripts/validate-sidecars.sh x86_64-pc-windows-msvc
#     TARGET_TRIPLE=x86_64-unknown-linux-gnu ./scripts/validate-sidecars.sh
#
set -euo pipefail

# Resolve repo root (this script lives in <root>/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$ROOT_DIR/src-tauri/binaries"

# shellcheck source=scripts/lib/target-triple.sh
source "$SCRIPT_DIR/lib/target-triple.sh"

# A positional argument overrides TARGET_TRIPLE (then host detection).
if [[ "${1:-}" != "" ]]; then
  TARGET_TRIPLE="$1"
fi
resolve_target  # sets TARGET_TRIPLE, TARGET_OS, OSX_ARCH, EXE_SUFFIX, EXPECT_FORMAT

if ! command -v file >/dev/null 2>&1; then
  echo "ERROR: the 'file' command is required to validate sidecar formats." >&2
  exit 1
fi

echo "→ Validating sidecars for $TARGET_TRIPLE (expect: $EXPECT_FORMAT) ..."

# Convert the EXPECT_FORMAT glob (e.g. "Mach-O*arm64") into a grep -E pattern.
EXPECT_RE="${EXPECT_FORMAT//\*/.*}"

status=0
for name in whisper-cli whisper-server llama-server; do
  path="$BIN_DIR/$name-$TARGET_TRIPLE$EXE_SUFFIX"

  if [[ ! -e "$path" ]]; then
    echo "✗ MISSING:    $path" >&2
    status=1
    continue
  fi
  if [[ ! -x "$path" ]]; then
    echo "✗ NOT EXEC:   $path (file exists but is not executable)" >&2
    status=1
    continue
  fi

  desc="$(file -b "$path" 2>/dev/null || true)"
  if echo "$desc" | grep -qiE "$EXPECT_RE"; then
    echo "✓ OK:         $path  [$desc]"
  else
    echo "✗ MISMATCH:   $path" >&2
    echo "    expected format matching: $EXPECT_FORMAT" >&2
    echo "    actual ('file'):          $desc" >&2
    status=1
  fi
done

if [[ "$status" -ne 0 ]]; then
  echo "" >&2
  echo "ERROR: one or more sidecars are missing or do not match target $TARGET_TRIPLE." >&2
  echo "  Provision them with ./scripts/fetch-whisper.sh and ./scripts/fetch-llama.sh" >&2
  echo "  (set TARGET_TRIPLE for a non-host target) before bundling." >&2
  exit 1
fi

echo ""
echo "✓ All sidecars present, executable, and matching $TARGET_TRIPLE."
