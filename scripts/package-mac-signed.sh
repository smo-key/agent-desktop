#!/usr/bin/env bash
#
# Build a SIGNED + NOTARIZED + STAPLED macOS bundle of agent-desktop.
#
# Why this exists: the plain `npm run package:mac` (`tauri build`) produces an
# ad-hoc / unsigned .app. Per src-tauri/entitlements.plist, the microphone only
# works reliably in a DISTRIBUTED build when the app is code-signed with a
# Developer ID, built with hardened runtime (already enabled in tauri.conf.json),
# and notarized by Apple. Gatekeeper on other machines also refuses to launch an
# unsigned/un-notarized app without the right-click "Open" dance.
#
# How it works: Tauri's bundler automatically code-signs and (when notarization
# credentials are present) submits to Apple's notary service and STAPLES the
# resulting ticket — all triggered purely by environment variables. This script
# just loads those vars from a gitignored .env.notarize, validates them, and
# shells out to `tauri build`. See:
#   https://v2.tauri.app/distribute/sign/macos/
#
# Setup (one time): copy .env.notarize.example -> .env.notarize and fill it in.
# See that file + the README steps for how to obtain each credential.
#
# Usage:
#     ./scripts/package-mac-signed.sh
#     npm run package:mac:signed
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.notarize"

# --- Load credentials --------------------------------------------------------
# Prefer a local .env.notarize, but allow the vars to already be exported in the
# environment (e.g. CI secrets) — in that case the file is optional.
if [[ -f "$ENV_FILE" ]]; then
  echo "[package:mac:signed] loading credentials from .env.notarize"
  set -a            # auto-export everything sourced
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "[package:mac:signed] no .env.notarize found — relying on exported env vars"
fi

# --- Validate signing identity ----------------------------------------------
if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "ERROR: APPLE_SIGNING_IDENTITY is not set." >&2
  echo "  This is your 'Developer ID Application: NAME (TEAMID)' identity." >&2
  echo "  List installed identities with:  security find-identity -v -p codesigning" >&2
  echo "  See .env.notarize.example for setup." >&2
  exit 1
fi

# --- Validate notarization credentials --------------------------------------
# Tauri accepts EITHER an App Store Connect API key (recommended) OR an Apple ID
# + app-specific password. We require one complete set.
has_api_key=0
has_apple_id=0
if [[ -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_PATH:-}" ]]; then
  has_api_key=1
fi
if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  has_apple_id=1
fi

if [[ "$has_api_key" -eq 0 && "$has_apple_id" -eq 0 ]]; then
  echo "ERROR: no complete notarization credential set found." >&2
  echo "  Provide ONE of:" >&2
  echo "    A) App Store Connect API key (recommended):" >&2
  echo "         APPLE_API_ISSUER, APPLE_API_KEY, APPLE_API_KEY_PATH" >&2
  echo "    B) Apple ID + app-specific password:" >&2
  echo "         APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID" >&2
  echo "  See .env.notarize.example for how to obtain these." >&2
  exit 1
fi

if [[ "$has_api_key" -eq 1 ]]; then
  echo "[package:mac:signed] notarizing via App Store Connect API key"
  # Tauri reads these directly; ensure the .p8 path is absolute and exists.
  if [[ ! -f "${APPLE_API_KEY_PATH}" ]]; then
    echo "ERROR: APPLE_API_KEY_PATH does not point to a file: ${APPLE_API_KEY_PATH}" >&2
    exit 1
  fi
else
  echo "[package:mac:signed] notarizing via Apple ID app-specific password"
fi

# --- Build -------------------------------------------------------------------
echo "[package:mac:signed] signing identity: ${APPLE_SIGNING_IDENTITY}"
echo "[package:mac:signed] running tauri build (this signs, notarizes, and staples)…"
cd "$ROOT"
exec npx tauri build
