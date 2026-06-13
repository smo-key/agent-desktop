#!/usr/bin/env bash
#
# Provision the llama.cpp `llama-server` sidecar binary for agent-desktop, for
# the HOST platform (or an explicit override target). `llama-server` serves an
# OpenAI-compatible `POST /v1/chat/completions` on localhost and is what the
# transcript-POLISH slice shells out to (see src-tauri/src/polish.rs).
#
# Tauri's sidecar (`externalBin`) convention requires the binary to be named with
# the Rust target triple appended, so this drops the binary at:
#
#     src-tauri/binaries/llama-server-<triple>[.exe]
#
# e.g. on Apple Silicon: llama-server-aarch64-apple-darwin; on the Windows runner:
# llama-server-x86_64-pc-windows-msvc.exe (Tauri also appends .exe on Windows).
#
# The TARGET TRIPLE and cmake architecture are derived from the HOST (via
# `uname -s` / `uname -m`), overridable via the `TARGET_TRIPLE` (and/or
# `TARGET_ARCH`) environment variable. The DEFAULT remains `aarch64-apple-darwin`
# so existing local Apple-Silicon development is unchanged. See
# scripts/lib/target-triple.sh for the full mapping.
#
# Per-OS build:
#   * macOS  — cmake with -DCMAKE_OSX_ARCHITECTURES=<arm64|x86_64> (Metal accel).
#   * Linux  — host-native gcc/clang toolchain for the host arch (no OSX flag).
#   * Windows — run under Git Bash, drive cmake with the Visual Studio / MSVC
#               generator to emit a NATIVE Windows .exe (NOT WSL/Linux, which
#               would produce a Linux ELF that cannot be a Windows sidecar).
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
# is the most portable way to get a current binary with native acceleration.
# (llama.cpp's upstream release assets vary over time; building from a pinned tag
# is stable.)
#
# Usage:
#     ./scripts/fetch-llama.sh              # build if missing (host target)
#     LLAMA_TAG=b4000 ./scripts/fetch-llama.sh   # pin a different tag
#     FORCE=1 ./scripts/fetch-llama.sh      # rebuild even if present
#     TARGET_TRIPLE=x86_64-pc-windows-msvc ./scripts/fetch-llama.sh  # override
#     DRY_RUN=1 ./scripts/fetch-llama.sh    # print resolved target + dest, no build
#
set -euo pipefail

# Resolve repo root (this script lives in <root>/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Config ------------------------------------------------------------------
# shellcheck source=scripts/lib/target-triple.sh
source "$SCRIPT_DIR/lib/target-triple.sh"
resolve_target  # sets TARGET_TRIPLE, TARGET_OS, OSX_ARCH, EXE_SUFFIX, EXPECT_FORMAT

LLAMA_TAG="${LLAMA_TAG:-master}"
REPO_URL="https://github.com/ggml-org/llama.cpp.git"

BIN_DIR="$ROOT_DIR/src-tauri/binaries"
DEST="$BIN_DIR/llama-server-$TARGET_TRIPLE$EXE_SUFFIX"

mkdir -p "$BIN_DIR"

# --- Dry run -----------------------------------------------------------------
# Resolve + print the chosen target without building (for testing the mapping).
if [[ "${DRY_RUN:-0}" == "1" || "${PRINT_TARGET:-0}" == "1" ]]; then
  echo "target triple : $TARGET_TRIPLE"
  echo "target os     : $TARGET_OS"
  echo "cmake osx arch: ${OSX_ARCH:-(none)}"
  echo "exe suffix    : ${EXE_SUFFIX:-(none)}"
  echo "llama-server  : $DEST"
  exit 0
fi

# --- Idempotency -------------------------------------------------------------
# Treat the tiny shell-script PLACEHOLDER (committed-build stub) as "not present"
# so a real provisioning run replaces it. A real binary is large and matches the
# expected on-disk FORMAT for the target (Mach-O / ELF / PE32+).
if [[ -x "$DEST" && "${FORCE:-0}" != "1" ]]; then
  # EXPECT_RE (from resolve_target) asserts the target's format AND arch.
  if file "$DEST" 2>/dev/null | grep -qiE "$EXPECT_RE"; then
    echo "✓ llama-server sidecar already present: $DEST"
    echo "  (set FORCE=1 to rebuild)"
    exit 0
  fi
  echo "→ Found a placeholder (not a $EXPECT_FORMAT binary) at $DEST; provisioning the real binary."
fi

# --- Tooling check -----------------------------------------------------------
for tool in git cmake; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: '$tool' is required to build llama.cpp but was not found." >&2
    echo "  Install it (e.g. 'brew install $tool') and re-run." >&2
    exit 1
  fi
done

# --- Per-OS cmake configuration ----------------------------------------------
# Assemble the architecture/generator flags for the resolved target.
CMAKE_CONFIGURE_ARGS=()
case "$TARGET_OS" in
  darwin)
    # Cross/native macOS arch is selected explicitly so an arm64 host can also
    # target x86_64 (and vice versa).
    CMAKE_CONFIGURE_ARGS+=("-DCMAKE_OSX_ARCHITECTURES=$OSX_ARCH") ;;
  linux)
    # Host-native gcc/clang toolchain for the host arch; no OSX arch flag.
    : ;;
  windows)
    # NATIVE Windows: drive cmake with the Visual Studio / MSVC generator so it
    # emits a PE .exe (NOT a WSL/Linux ELF). The bundled VS generator targets
    # the host (x64) by default.
    CMAKE_CONFIGURE_ARGS+=("-G" "Visual Studio 17 2022" "-A" "x64") ;;
esac

# --- Build -------------------------------------------------------------------
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "→ Cloning llama.cpp@$LLAMA_TAG (shallow) into $WORK_DIR ..."
git clone --depth 1 --branch "$LLAMA_TAG" "$REPO_URL" "$WORK_DIR/llama.cpp"

echo "→ Building llama-server (Release) for $TARGET_TRIPLE ..."
cmake -S "$WORK_DIR/llama.cpp" -B "$WORK_DIR/build" \
  -DCMAKE_BUILD_TYPE=Release \
  "${CMAKE_CONFIGURE_ARGS[@]}" \
  -DBUILD_SHARED_LIBS=OFF \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_SERVER=ON
# BUILD_SHARED_LIBS=OFF links libllama/libggml STATICALLY into llama-server so the
# copied binary is self-contained (a shared build leaves it depending on @rpath
# dylibs in the deleted build tree, which fails to load as a sidecar).
cmake --build "$WORK_DIR/build" --config Release --target llama-server -j

# Locate the produced binary (path varies slightly across llama.cpp versions and
# generators; the multi-config VS generator nests Release/ under bin/).
BUILT=""
for candidate in \
  "$WORK_DIR/build/bin/llama-server$EXE_SUFFIX" \
  "$WORK_DIR/build/bin/Release/llama-server$EXE_SUFFIX" \
  "$WORK_DIR/build/llama-server$EXE_SUFFIX"; do
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
