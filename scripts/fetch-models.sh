#!/usr/bin/env bash
#
# Provision the BUNDLED whisper model for agent-desktop.
#
# The voice-input feature bundles the tiny whisper model as a Tauri resource so
# transcription works on first run with NO network (offline). Tauri's
# `bundle.resources` in `tauri.conf.json` references it at:
#
#     src-tauri/models/ggml-tiny.bin
#
# This file is NOT committed to git (it is ~75 MB; see src-tauri/.gitignore +
# src-tauri/models/README.md). This script is IDEMPOTENT: it no-ops if the model
# is already present (and not the placeholder).
#
# Larger models (small / large-v3-turbo) and the polish LLM are downloaded at
# RUNTIME into <app_data_dir>/models/ by the app (voice_download_models), NOT
# bundled — so they are NOT fetched here.
#
# REQUIRES NETWORK at build time.
#
# Usage:
#     ./scripts/fetch-models.sh          # download the bundled tiny model if missing
#     FORCE=1 ./scripts/fetch-models.sh  # re-download even if present
#
set -euo pipefail

# --- Config ------------------------------------------------------------------
# Must match `models::TINY.filename` / `.url` in src-tauri/src/models.rs.
MODEL_FILE="ggml-tiny.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"

# Resolve repo root (this script lives in <root>/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MODELS_DIR="$ROOT_DIR/src-tauri/models"
DEST="$MODELS_DIR/$MODEL_FILE"

mkdir -p "$MODELS_DIR"

# --- Idempotency -------------------------------------------------------------
# Treat a tiny (< 1 MB) file as the git-ignored placeholder and replace it; a
# real model is tens of MB.
if [[ -f "$DEST" && "${FORCE:-0}" != "1" ]]; then
  size=$(wc -c < "$DEST" | tr -d ' ')
  if [[ "$size" -gt 1000000 ]]; then
    echo "✓ bundled model already present: $DEST ($size bytes)"
    echo "  (set FORCE=1 to re-download)"
    exit 0
  fi
  echo "→ replacing placeholder ($size bytes) with the real model ..."
fi

# --- Tooling check -----------------------------------------------------------
# curl and wget both ship with Git Bash on Windows, on macOS, and on the Linux
# CI runners, so this provisions the (architecture-independent) model everywhere.
if command -v curl >/dev/null 2>&1; then
  DL=(curl -fL --retry 3 -o "$DEST.part" "$MODEL_URL")
elif command -v wget >/dev/null 2>&1; then
  DL=(wget --tries=3 -O "$DEST.part" "$MODEL_URL")
else
  echo "ERROR: need 'curl' or 'wget' to download the bundled model." >&2
  exit 1
fi

# --- Download (atomic) -------------------------------------------------------
echo "→ Downloading $MODEL_FILE from Hugging Face ..."
"${DL[@]}"
mv "$DEST.part" "$DEST"

echo ""
echo "✓ Installed bundled model:"
echo "    $DEST"
echo ""
echo "  This file is git-ignored (provisioned, not committed). It is bundled by"
echo "  'npm run tauri build' via tauri.conf.json bundle.resources. Larger models"
echo "  (small / large-v3-turbo) and the polish LLM download at runtime."
