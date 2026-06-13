#!/usr/bin/env bash
#
# Write the `package.json` version into the OTHER manifests so the built artifact
# version always matches the release tag. `package.json` is the single source of
# version truth; this propagates it to:
#
#     src-tauri/tauri.conf.json   top-level "version"
#     src-tauri/Cargo.toml        [package] version = "<x.y.z>"
#     src-tauri/Cargo.lock        the agent-desktop package entry
#
# The pipeline runs this on a release before committing the `chore(release)` sync
# commit and tagging it. It is IDEMPOTENT: re-running when everything is already
# in sync changes nothing and exits 0.
#
# Usage:
#     ./scripts/sync-version.sh             # use the version from package.json
#     ./scripts/sync-version.sh 1.2.3       # set an explicit version
#     DRY_RUN=1 ./scripts/sync-version.sh   # print what WOULD change; write nothing
#
# Notes:
#   * Uses `node` to read/rewrite the JSON manifests (preserving 2-space indent).
#   * `Cargo.lock` is updated via `cargo update -p agent-desktop --precise <v>`
#     run in src-tauri/. If `cargo` is unavailable, it warns and continues (the
#     CI runner always has cargo; the lock just won't be touched locally).
#
set -euo pipefail

# Resolve repo root (this script lives in <root>/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PKG_JSON="$ROOT_DIR/package.json"
TAURI_CONF="$ROOT_DIR/src-tauri/tauri.conf.json"
CARGO_TOML="$ROOT_DIR/src-tauri/Cargo.toml"
CARGO_LOCK="$ROOT_DIR/src-tauri/Cargo.lock"

DRY_RUN="${DRY_RUN:-0}"

# --- Resolve the version -----------------------------------------------------
# A positional arg wins; otherwise read package.json.
VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  if command -v node >/dev/null 2>&1; then
    VERSION="$(node -p "require('$PKG_JSON').version")"
  elif command -v jq >/dev/null 2>&1; then
    VERSION="$(jq -r .version "$PKG_JSON")"
  else
    echo "ERROR: need 'node' or 'jq' (or a version arg) to read package.json." >&2
    exit 1
  fi
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$ ]]; then
  echo "ERROR: '$VERSION' does not look like a semver version (x.y.z)." >&2
  exit 1
fi

echo "→ Syncing version $VERSION into the manifests ..."
[[ "$DRY_RUN" == "1" ]] && echo "  (DRY_RUN: nothing will be written)"

# --- 1. tauri.conf.json ------------------------------------------------------
# Read the current value with node; only rewrite when it differs (idempotent),
# preserving 2-space indentation and a trailing newline.
CUR_TAURI="$(node -p "require('$TAURI_CONF').version" 2>/dev/null || echo "")"
if [[ "$CUR_TAURI" == "$VERSION" ]]; then
  echo "✓ tauri.conf.json already at $VERSION"
else
  echo "  tauri.conf.json: $CUR_TAURI -> $VERSION"
  if [[ "$DRY_RUN" != "1" ]]; then
    # shellcheck disable=SC2016  # this is a JS program; $-vars are JS, not shell
    node -e '
      const fs = require("fs");
      const p = process.argv[1], v = process.argv[2];
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      j.version = v;
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
    ' "$TAURI_CONF" "$VERSION"
  fi
fi

# --- 2. Cargo.toml -----------------------------------------------------------
# Edit ONLY the [package] version line (the first `version = "..."` after the
# [package] header), so dependency versions are never touched.
CUR_CARGO="$(grep -m1 -E '^version[[:space:]]*=' "$CARGO_TOML" | sed -E 's/^version[[:space:]]*=[[:space:]]*"([^"]*)".*/\1/' || echo "")"
if [[ "$CUR_CARGO" == "$VERSION" ]]; then
  echo "✓ Cargo.toml already at $VERSION"
else
  echo "  Cargo.toml: $CUR_CARGO -> $VERSION"
  if [[ "$DRY_RUN" != "1" ]]; then
    # Rewrite the first `version = "..."` line only (the [package] version, which
    # appears before any [dependencies] table in this manifest).
    # shellcheck disable=SC2016  # this is a JS program; $-vars are JS, not shell
    node -e '
      const fs = require("fs");
      const p = process.argv[1], v = process.argv[2];
      const src = fs.readFileSync(p, "utf8");
      let done = false;
      const out = src.replace(/^version\s*=\s*"[^"]*"/m, (m) => {
        if (done) return m;
        done = true;
        return `version = "${v}"`;
      });
      fs.writeFileSync(p, out);
    ' "$CARGO_TOML" "$VERSION"
  fi
fi

# --- 3. Cargo.lock -----------------------------------------------------------
# Keep the lockfile's agent-desktop entry in step. Prefer cargo (authoritative);
# fall back to a warning if cargo is unavailable (CI always has it).
CUR_LOCK=""
if [[ -f "$CARGO_LOCK" ]]; then
  CUR_LOCK="$(awk '
    /^\[\[package\]\]/ { inpkg=0 }
    /^name = "agent-desktop"/ { inpkg=1 }
    inpkg && /^version = / { gsub(/version = "|"/, ""); print; exit }
  ' "$CARGO_LOCK" || echo "")"
fi

if [[ "$CUR_LOCK" == "$VERSION" ]]; then
  echo "✓ Cargo.lock already at $VERSION"
elif [[ "$DRY_RUN" == "1" ]]; then
  echo "  Cargo.lock: ${CUR_LOCK:-<unknown>} -> $VERSION (via 'cargo update -p agent-desktop --precise $VERSION')"
elif command -v cargo >/dev/null 2>&1; then
  echo "  Cargo.lock: ${CUR_LOCK:-<unknown>} -> $VERSION (cargo update)"
  # Run inside src-tauri so cargo finds the manifest. --offline avoids network;
  # the package is local so no registry fetch is needed for a precise bump. If
  # the offline attempt fails, retry without --offline.
  (
    cd "$ROOT_DIR/src-tauri"
    if ! cargo update -p agent-desktop --precise "$VERSION" --offline 2>/dev/null; then
      cargo update -p agent-desktop --precise "$VERSION"
    fi
  )
else
  echo "  WARNING: cargo not found; leaving Cargo.lock unchanged" >&2
  echo "           (CI has cargo; the lock will be synced there)." >&2
fi

echo ""
if [[ "$DRY_RUN" == "1" ]]; then
  echo "✓ DRY_RUN complete — no files modified."
else
  echo "✓ Version $VERSION synced into tauri.conf.json, Cargo.toml, and Cargo.lock."
fi
