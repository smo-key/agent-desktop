#!/usr/bin/env bash
#
# Provision the whisper.cpp `whisper-cli` AND `whisper-server` sidecar binaries
# for agent-desktop, for the HOST platform (or an explicit override target).
#
# Tauri's sidecar (`externalBin`) convention requires the binary to be named with
# the Rust target triple appended, so this drops the binaries at:
#
#     src-tauri/binaries/whisper-cli-<triple>[.exe]
#     src-tauri/binaries/whisper-server-<triple>[.exe]
#
# e.g. on Apple Silicon: whisper-cli-aarch64-apple-darwin; on the Windows runner:
# whisper-cli-x86_64-pc-windows-msvc.exe (Tauri also appends .exe on Windows).
#
# The TARGET TRIPLE and cmake architecture are derived from the HOST (via
# `uname -s` / `uname -m`), overridable via the `TARGET_TRIPLE` (and/or
# `TARGET_ARCH`) environment variable. The DEFAULT remains `aarch64-apple-darwin`
# so existing local Apple-Silicon development is unchanged. See
# scripts/lib/target-triple.sh for the full mapping.
#
# Per-OS build:
#   * macOS  — cmake with -DCMAKE_OSX_ARCHITECTURES=<arm64|x86_64>.
#   * Linux  — host-native gcc/clang toolchain for the host arch (no OSX flag).
#   * Windows — run under Git Bash, drive cmake with the Visual Studio / MSVC
#               generator to emit a NATIVE Windows .exe (NOT WSL/Linux, which
#               would produce a Linux ELF that cannot be a Windows sidecar).
#
# `whisper-cli` runs the one-shot FINAL transcription pass; `whisper-server` is a
# long-lived HTTP server that keeps the tiny model resident for low-latency live
# PARTIALS (see src-tauri/src/whisper_server.rs). Both are built statically from
# the same checkout so each is self-contained.
#
# `tauri.conf.json` registers it as `bundle.externalBin: ["binaries/whisper-cli"]`
# (Tauri appends the triple at bundle time) and `capabilities/default.json`
# grants it `shell:allow-execute` as a sidecar.
#
# REQUIRES NETWORK at build time. The binary is NOT committed to git (see
# src-tauri/.gitignore + src-tauri/binaries/README.md). This script is
# IDEMPOTENT: it no-ops if the binaries are already present.
#
# Strategy: clone + build whisper.cpp from source (its `whisper-cli` target),
# which is the most portable way to get a current binary. (whisper.cpp's
# upstream release assets vary over time; building from a pinned tag is stable.)
#
# Usage:
#     ./scripts/fetch-whisper.sh            # build if missing (host target)
#     WHISPER_TAG=v1.7.4 ./scripts/fetch-whisper.sh   # pin a different tag
#     FORCE=1 ./scripts/fetch-whisper.sh    # rebuild even if present
#     TARGET_TRIPLE=x86_64-pc-windows-msvc ./scripts/fetch-whisper.sh  # override
#     DRY_RUN=1 ./scripts/fetch-whisper.sh  # print resolved target + dest, no build
#
set -euo pipefail

# Resolve repo root (this script lives in <root>/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Config ------------------------------------------------------------------
# shellcheck source=scripts/lib/target-triple.sh
source "$SCRIPT_DIR/lib/target-triple.sh"
resolve_target  # sets TARGET_TRIPLE, TARGET_OS, OSX_ARCH, EXE_SUFFIX, EXPECT_FORMAT

WHISPER_TAG="${WHISPER_TAG:-v1.7.4}"
REPO_URL="https://github.com/ggml-org/whisper.cpp.git"

BIN_DIR="$ROOT_DIR/src-tauri/binaries"
DEST="$BIN_DIR/whisper-cli-$TARGET_TRIPLE$EXE_SUFFIX"
DEST_SERVER="$BIN_DIR/whisper-server-$TARGET_TRIPLE$EXE_SUFFIX"

mkdir -p "$BIN_DIR"

# --- Dry run -----------------------------------------------------------------
# Resolve + print the chosen target without building (for testing the mapping).
if [[ "${DRY_RUN:-0}" == "1" || "${PRINT_TARGET:-0}" == "1" ]]; then
  echo "target triple : $TARGET_TRIPLE"
  echo "target os     : $TARGET_OS"
  echo "cmake osx arch: ${OSX_ARCH:-(none)}"
  echo "exe suffix    : ${EXE_SUFFIX:-(none)}"
  echo "whisper-cli   : $DEST"
  echo "whisper-server: $DEST_SERVER"
  exit 0
fi

# --- Idempotency -------------------------------------------------------------
# Build only when at least one of the two sidecars is missing (or FORCE=1).
if [[ -x "$DEST" && -x "$DEST_SERVER" && "${FORCE:-0}" != "1" ]]; then
  echo "✓ whisper-cli sidecar already present:    $DEST"
  echo "✓ whisper-server sidecar already present: $DEST_SERVER"
  echo "  (set FORCE=1 to rebuild)"
  exit 0
fi

# --- Tooling check -----------------------------------------------------------
for tool in git cmake; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: '$tool' is required to build whisper.cpp but was not found." >&2
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

echo "→ Cloning whisper.cpp@$WHISPER_TAG (shallow) into $WORK_DIR ..."
git clone --depth 1 --branch "$WHISPER_TAG" "$REPO_URL" "$WORK_DIR/whisper.cpp"

echo "→ Building whisper-cli + whisper-server (Release) for $TARGET_TRIPLE ..."
cmake -S "$WORK_DIR/whisper.cpp" -B "$WORK_DIR/build" \
  -DCMAKE_BUILD_TYPE=Release \
  "${CMAKE_CONFIGURE_ARGS[@]}" \
  -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON
# BUILD_SHARED_LIBS=OFF links libwhisper/libggml STATICALLY into the binaries so
# each copied binary is self-contained. A shared build leaves them depending on
# @rpath dylibs in the (deleted) temp build tree, which fails to load as a sidecar.
# Build BOTH targets from the one configured tree (same static flags).
cmake --build "$WORK_DIR/build" --config Release --target whisper-cli whisper-server -j

# --- Locate + install whisper-cli -------------------------------------------
# (path varies slightly across whisper.cpp versions and generators; the
# multi-config VS generator nests Release/ under bin/).
BUILT=""
for candidate in \
  "$WORK_DIR/build/bin/whisper-cli$EXE_SUFFIX" \
  "$WORK_DIR/build/bin/Release/whisper-cli$EXE_SUFFIX" \
  "$WORK_DIR/build/whisper-cli$EXE_SUFFIX"; do
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

# --- Locate + install whisper-server ----------------------------------------
BUILT_SERVER=""
for candidate in \
  "$WORK_DIR/build/bin/whisper-server$EXE_SUFFIX" \
  "$WORK_DIR/build/bin/Release/whisper-server$EXE_SUFFIX" \
  "$WORK_DIR/build/whisper-server$EXE_SUFFIX"; do
  if [[ -f "$candidate" ]]; then
    BUILT_SERVER="$candidate"
    break
  fi
done

if [[ -z "$BUILT_SERVER" ]]; then
  echo "ERROR: build succeeded but whisper-server binary not found under $WORK_DIR/build." >&2
  echo "  Inspect the build tree; the target name may have changed upstream." >&2
  exit 1
fi

cp "$BUILT_SERVER" "$DEST_SERVER"
chmod +x "$DEST_SERVER"

echo ""
echo "✓ Installed whisper-cli sidecar:"
echo "    $DEST"
echo "✓ Installed whisper-server sidecar:"
echo "    $DEST_SERVER"
echo ""
echo "  These binaries are git-ignored (provisioned, not committed). They will be"
echo "  bundled by 'npm run tauri build' via tauri.conf.json externalBin."
echo "  Model weights (ggml-*.bin) are downloaded separately at runtime by the"
echo "  model-management slice (not bundled)."
