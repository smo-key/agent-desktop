#!/usr/bin/env bash
#
# Provision the llama.cpp `llama-server` sidecar binary for the macOS arm64 build
# of agent-desktop. `llama-server` serves an OpenAI-compatible
# `POST /v1/chat/completions` on localhost and is what the transcript-POLISH slice
# shells out to (see src-tauri/src/polish.rs).
#
# Tauri's sidecar (`externalBin`) convention requires the binary to be named with
# the Rust target triple appended, so this drops the binary at:
#
#     src-tauri/binaries/llama-server-aarch64-apple-darwin
#
# `tauri.conf.json` registers it as `bundle.externalBin: ["binaries/llama-server"]`
# (Tauri appends the triple at bundle time) and `capabilities/default.json`
# grants it `shell:allow-execute` as a sidecar.
#
# REQUIRES NETWORK at build time. The binary is NOT committed to git (see
# src-tauri/.gitignore + src-tauri/binaries/README.md). This script is
# IDEMPOTENT: it no-ops if the binary is already present.
#
# Strategy: clone + build llama.cpp from source (its `llama-server` target), which
# is the most portable way to get a current arm64 binary with Metal acceleration.
# (llama.cpp's upstream release assets vary over time; building from a pinned tag
# is stable.)
#
# Usage:
#     ./scripts/fetch-llama.sh              # build if missing
#     LLAMA_TAG=b4000 ./scripts/fetch-llama.sh   # pin a different tag
#     FORCE=1 ./scripts/fetch-llama.sh      # rebuild even if present
#
set -euo pipefail

# --- Config ------------------------------------------------------------------
TARGET_TRIPLE="aarch64-apple-darwin"
LLAMA_TAG="${LLAMA_TAG:-master}"
REPO_URL="https://github.com/ggml-org/llama.cpp.git"

# Resolve repo root (this script lives in <root>/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$ROOT_DIR/src-tauri/binaries"
DEST="$BIN_DIR/llama-server-$TARGET_TRIPLE"

mkdir -p "$BIN_DIR"

# --- Idempotency -------------------------------------------------------------
# Treat the tiny shell-script PLACEHOLDER (committed-build stub) as "not present"
# so a real provisioning run replaces it. A real binary is large + Mach-O.
if [[ -x "$DEST" && "${FORCE:-0}" != "1" ]]; then
  if file "$DEST" 2>/dev/null | grep -qi "mach-o"; then
    echo "✓ llama-server sidecar already present: $DEST"
    echo "  (set FORCE=1 to rebuild)"
    exit 0
  fi
  echo "→ Found a non-Mach-O placeholder at $DEST; provisioning the real binary."
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
    echo "ERROR: '$tool' is required to build llama.cpp but was not found." >&2
    echo "  Install it (e.g. 'brew install $tool') and re-run." >&2
    exit 1
  fi
done

# --- Build -------------------------------------------------------------------
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "→ Cloning llama.cpp@$LLAMA_TAG (shallow) into $WORK_DIR ..."
git clone --depth 1 --branch "$LLAMA_TAG" "$REPO_URL" "$WORK_DIR/llama.cpp"

echo "→ Building llama-server (Release, Metal) ..."
cmake -S "$WORK_DIR/llama.cpp" -B "$WORK_DIR/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DBUILD_SHARED_LIBS=OFF \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_SERVER=ON
# BUILD_SHARED_LIBS=OFF links libllama/libggml STATICALLY into llama-server so the
# copied binary is self-contained (a shared build leaves it depending on @rpath
# dylibs in the deleted build tree, which fails to load as a sidecar).
cmake --build "$WORK_DIR/build" --config Release --target llama-server -j

# Locate the produced binary (path varies slightly across llama.cpp versions).
BUILT=""
for candidate in \
  "$WORK_DIR/build/bin/llama-server" \
  "$WORK_DIR/build/bin/Release/llama-server" \
  "$WORK_DIR/build/llama-server"; do
  if [[ -f "$candidate" ]]; then
    BUILT="$candidate"
    break
  fi
done

if [[ -z "$BUILT" ]]; then
  echo "ERROR: build succeeded but llama-server binary not found under $WORK_DIR/build." >&2
  echo "  Inspect the build tree; the target name may have changed upstream." >&2
  exit 1
fi

cp "$BUILT" "$DEST"
chmod +x "$DEST"

echo ""
echo "✓ Installed llama-server sidecar:"
echo "    $DEST"
echo ""
echo "  This binary is git-ignored (provisioned, not committed). It will be"
echo "  bundled by 'npm run tauri build' via tauri.conf.json externalBin."
echo "  The polish GGUF model (Qwen3 1.7B Q4_K_M) is downloaded separately at"
echo "  runtime by the model-management slice when polish is enabled (not bundled)."
