#!/usr/bin/env bash
#
# Provision the whisper.cpp `whisper-cli` sidecar binary for the macOS arm64
# build of agent-desktop.
#
# Tauri's sidecar (`externalBin`) convention requires the binary to be named with
# the Rust target triple appended, so this drops the binary at:
#
#     src-tauri/binaries/whisper-cli-aarch64-apple-darwin
#
# `tauri.conf.json` registers it as `bundle.externalBin: ["binaries/whisper-cli"]`
# (Tauri appends the triple at bundle time) and `capabilities/default.json`
# grants it `shell:allow-execute` as a sidecar.
#
# REQUIRES NETWORK at build time. The binary is NOT committed to git (see
# src-tauri/.gitignore + src-tauri/binaries/README.md). This script is
# IDEMPOTENT: it no-ops if the binary is already present.
#
# Strategy: clone + build whisper.cpp from source (its `whisper-cli` target),
# which is the most portable way to get a current arm64 binary. (whisper.cpp's
# upstream release assets vary over time; building from a pinned tag is stable.)
#
# Usage:
#     ./scripts/fetch-whisper.sh            # build if missing
#     WHISPER_TAG=v1.7.4 ./scripts/fetch-whisper.sh   # pin a different tag
#     FORCE=1 ./scripts/fetch-whisper.sh    # rebuild even if present
#
set -euo pipefail

# --- Config ------------------------------------------------------------------
TARGET_TRIPLE="aarch64-apple-darwin"
WHISPER_TAG="${WHISPER_TAG:-v1.7.4}"
REPO_URL="https://github.com/ggml-org/whisper.cpp.git"

# Resolve repo root (this script lives in <root>/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$ROOT_DIR/src-tauri/binaries"
DEST="$BIN_DIR/whisper-cli-$TARGET_TRIPLE"

mkdir -p "$BIN_DIR"

# --- Idempotency -------------------------------------------------------------
if [[ -x "$DEST" && "${FORCE:-0}" != "1" ]]; then
  echo "✓ whisper-cli sidecar already present: $DEST"
  echo "  (set FORCE=1 to rebuild)"
  exit 0
fi

# --- Platform guard ----------------------------------------------------------
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "WARNING: this script builds an Apple Silicon (arm64 macOS) binary." >&2
  echo "  Detected: $(uname -s) $(uname -m). The produced binary may not match" >&2
  echo "  the '$TARGET_TRIPLE' sidecar name. Continuing anyway." >&2
fi

# --- Tooling check -----------------------------------------------------------
for tool in git cmake; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: '$tool' is required to build whisper.cpp but was not found." >&2
    echo "  Install it (e.g. 'brew install $tool') and re-run." >&2
    exit 1
  fi
done

# --- Build -------------------------------------------------------------------
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "→ Cloning whisper.cpp@$WHISPER_TAG (shallow) into $WORK_DIR ..."
git clone --depth 1 --branch "$WHISPER_TAG" "$REPO_URL" "$WORK_DIR/whisper.cpp"

echo "→ Building whisper-cli (Release) ..."
cmake -S "$WORK_DIR/whisper.cpp" -B "$WORK_DIR/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON
# BUILD_SHARED_LIBS=OFF links libwhisper/libggml STATICALLY into whisper-cli so the
# copied binary is self-contained. A shared build leaves the CLI depending on
# @rpath dylibs in the (deleted) temp build tree, which fails to load as a sidecar.
cmake --build "$WORK_DIR/build" --config Release --target whisper-cli -j

# Locate the produced binary (path varies slightly across whisper.cpp versions).
BUILT=""
for candidate in \
  "$WORK_DIR/build/bin/whisper-cli" \
  "$WORK_DIR/build/bin/Release/whisper-cli" \
  "$WORK_DIR/build/whisper-cli"; do
  if [[ -f "$candidate" ]]; then
    BUILT="$candidate"
    break
  fi
done

if [[ -z "$BUILT" ]]; then
  echo "ERROR: build succeeded but whisper-cli binary not found under $WORK_DIR/build." >&2
  echo "  Inspect the build tree; the target name may have changed upstream." >&2
  exit 1
fi

cp "$BUILT" "$DEST"
chmod +x "$DEST"

echo ""
echo "✓ Installed whisper-cli sidecar:"
echo "    $DEST"
echo ""
echo "  This binary is git-ignored (provisioned, not committed). It will be"
echo "  bundled by 'npm run tauri build' via tauri.conf.json externalBin."
echo "  Model weights (ggml-*.bin) are downloaded separately at runtime by the"
echo "  model-management slice (not bundled)."
