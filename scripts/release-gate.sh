#!/usr/bin/env bash
#
# Decide whether a release is DUE for the current `package.json` version.
#
# The release pipeline single-sources the version from `package.json`. This gate
# reads that version, finds the highest existing `v*` git tag, and decides
# `should_release`:
#
#   release IFF  package version  >  highest existing v* tag   (strict semver)
#          AND   no tag `v<version>` already exists            (idempotent)
#
# When there are NO tags yet, the latest tag is treated as `0.0.0`, so any real
# version (e.g. 0.1.0) releases. When the package version equals the latest tag,
# or a tag `v<version>` already exists, `should_release=false` and the script
# still EXITS 0 (a no-op push must not fail the pipeline).
#
# In GitHub Actions (`$GITHUB_OUTPUT` set) this writes the step outputs:
#     should_release=true|false
#     version=<x.y.z>
#     tag=v<x.y.z>
# Run locally (no `$GITHUB_OUTPUT`), it just prints them to stdout.
#
# Usage:
#     ./scripts/release-gate.sh                 # gate the package.json version
#     VERSION=1.2.3 ./scripts/release-gate.sh   # gate an explicit version
#     DRY_RUN=1 ./scripts/release-gate.sh       # print decision; never writes outputs
#
# Notes:
#   * Requires `node` (used to read package.json reliably) and `git`.
#   * Semver compare here handles plain X.Y.Z (and ignores any pre-release/build
#     suffix on the package version for the comparison) — sufficient for this
#     project's versioning scheme.
#
set -euo pipefail

# Resolve repo root (this script lives in <root>/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Read the package version ------------------------------------------------
# Allow an explicit override via $VERSION (handy for testing a higher version
# against a lower tag without mutating package.json).
if [[ -n "${VERSION:-}" ]]; then
  : # explicit override wins; keep $VERSION as-is
elif command -v node >/dev/null 2>&1; then
  VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
elif command -v jq >/dev/null 2>&1; then
  VERSION="$(jq -r .version "$ROOT_DIR/package.json")"
else
  echo "ERROR: need 'node' or 'jq' (or the VERSION env override) to read package.json." >&2
  exit 1
fi

if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
  echo "ERROR: could not determine version from package.json." >&2
  exit 1
fi

TAG="v$VERSION"

# --- Find the highest existing v* tag ----------------------------------------
# `--sort=-v:refname` orders tags by semantic version, newest first.
LATEST_TAG="$(git -C "$ROOT_DIR" tag --list 'v*' --sort=-v:refname | head -1 || true)"
# Strip the leading 'v'; treat "no tags yet" as 0.0.0 so any real version wins.
LATEST_VERSION="${LATEST_TAG#v}"
LATEST_VERSION="${LATEST_VERSION:-0.0.0}"

# --- Semver compare ----------------------------------------------------------
# Echoes  1 if $1 > $2,  0 if equal,  -1 if $1 < $2.  Compares the numeric
# major.minor.patch fields; any pre-release/build suffix is dropped first.
semver_cmp() {
  local a="${1%%[-+]*}" b="${2%%[-+]*}"
  local IFS=.
  # shellcheck disable=SC2206
  local av=($a) bv=($b)
  local i
  for i in 0 1 2; do
    local an="${av[i]:-0}" bn="${bv[i]:-0}"
    # Default any non-numeric field to 0 so a malformed tag can't crash compare.
    [[ "$an" =~ ^[0-9]+$ ]] || an=0
    [[ "$bn" =~ ^[0-9]+$ ]] || bn=0
    if ((an > bn)); then echo 1; return; fi
    if ((an < bn)); then echo -1; return; fi
  done
  echo 0
}

CMP="$(semver_cmp "$VERSION" "$LATEST_VERSION")"

# --- Decide ------------------------------------------------------------------
SHOULD_RELEASE=false
REASON=""

if git -C "$ROOT_DIR" rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  REASON="tag $TAG already exists (idempotent: no re-release)"
elif [[ "$CMP" == "1" ]]; then
  SHOULD_RELEASE=true
  REASON="version $VERSION > latest tag ${LATEST_TAG:-<none>} ($LATEST_VERSION)"
elif [[ "$CMP" == "0" ]]; then
  REASON="version $VERSION equals latest tag ${LATEST_TAG:-<none>} (no bump)"
else
  REASON="version $VERSION is not greater than latest tag ${LATEST_TAG:-<none>} ($LATEST_VERSION)"
fi

# --- Report ------------------------------------------------------------------
echo "package version : $VERSION"
echo "latest v* tag   : ${LATEST_TAG:-<none>} ($LATEST_VERSION)"
echo "tag to create   : $TAG"
echo "should_release  : $SHOULD_RELEASE"
echo "reason          : $REASON"

# In DRY_RUN, never touch the Actions output file.
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "(DRY_RUN: not writing \$GITHUB_OUTPUT)"
  exit 0
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "should_release=$SHOULD_RELEASE"
    echo "version=$VERSION"
    echo "tag=$TAG"
  } >>"$GITHUB_OUTPUT"
fi

exit 0
