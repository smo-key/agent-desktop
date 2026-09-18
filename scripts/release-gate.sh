#!/usr/bin/env bash
#
# Decide whether a release is DUE for the current `package.json` version, on the
# release channel this run belongs to.
#
# The release pipeline single-sources the version from `package.json`. This gate
# reads that version, reads the channel from the branch (`main` -> stable,
# `beta` -> beta), and asks `scripts/lib/version-compare.mjs` — which holds ALL
# the version math, prerelease-aware and unit-tested — whether to release:
#
#   stable  release IFF  version has no prerelease suffix
#                  AND   version > highest SUFFIX-FREE v* tag   (prerelease tags ignored)
#   beta    release IFF  version HAS a prerelease suffix
#                  AND   version > highest v* tag on EITHER lane
#   both    AND   no tag `v<version>` already exists             (idempotent)
#
# When there are no qualifying tags yet, the baseline is treated as `0.0.0`, so
# any real version releases. Every "no" answer still EXITS 0 (a no-op push must
# not fail the pipeline) — including a version whose FORM does not match its
# branch (a prerelease pushed to `main`, or a plain version pushed to `beta`).
#
# In GitHub Actions (`$GITHUB_OUTPUT` set) this writes the step outputs:
#     should_release=true|false
#     version=<x.y.z[-pre]>
#     tag=v<x.y.z[-pre]>
#     channel=stable|beta
#     tag_exists=true|false   (this version has already SHIPPED; the workflow's
#                              force_publish override refuses to overrule it)
# Run locally (no `$GITHUB_OUTPUT`), it just prints them to stdout.
#
# Usage:
#     ./scripts/release-gate.sh                          # gate package.json on this branch
#     VERSION=1.2.3 ./scripts/release-gate.sh            # gate an explicit version
#     CHANNEL=beta ./scripts/release-gate.sh             # gate an explicit channel
#     DRY_RUN=1 ./scripts/release-gate.sh                # print decision; never writes outputs
#
# Notes:
#   * Requires `node` (reads package.json and runs the comparator) and `git`.
#   * The comparator implements full SemVer 2.0.0 precedence. The previous shell
#     `semver_cmp` truncated at `-`/`+`, which made consecutive betas compare
#     equal AND — once any prerelease tag existed — stalled the stable lane too.
#
set -euo pipefail

# Resolve repo root (this script lives in <root>/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: need 'node' to run the release gate." >&2
  exit 1
fi

# --- Read the package version ------------------------------------------------
# Allow an explicit override via $VERSION (handy for testing a higher version
# against a lower tag without mutating package.json).
if [[ -z "${VERSION:-}" ]]; then
  VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
fi

if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
  echo "ERROR: could not determine version from package.json." >&2
  exit 1
fi

# --- Resolve the channel from the branch -------------------------------------
# $CHANNEL wins; otherwise map the branch (Actions sets GITHUB_REF_NAME; locally
# we ask git). An unknown branch is NOT a release branch — report and no-op.
BRANCH="${GITHUB_REF_NAME:-$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")}"
if [[ -z "${CHANNEL:-}" ]]; then
  # The module path goes through argv + pathToFileURL, never into the JS source:
  # `import()` resolves its specifier as a URL, so a checkout path containing `#`
  # or `?` would otherwise be truncated at that character (ERR_MODULE_NOT_FOUND),
  # and one containing `'` would be a syntax error.
  CHANNEL="$(node -e "
    import('node:url').then(async ({ pathToFileURL }) => {
      const m = await import(pathToFileURL(process.argv[1]).href);
      process.stdout.write(m.channelForBranch(process.argv[2]) ?? '');
    });
  " "$ROOT_DIR/scripts/lib/version-compare.mjs" "$BRANCH")"
fi

TAG="v$VERSION"

if [[ -z "$CHANNEL" ]]; then
  echo "package version : $VERSION"
  echo "branch          : ${BRANCH:-<unknown>}"
  echo "channel         : <none> (not a release branch)"
  echo "should_release  : false"
  echo "reason          : branch '${BRANCH:-<unknown>}' is not a release branch (main or beta)"
  if [[ "${DRY_RUN:-0}" != "1" && -n "${GITHUB_OUTPUT:-}" ]]; then
    {
      echo "should_release=false"
      echo "version=$VERSION"
      echo "tag=$TAG"
      echo "channel="
      echo "tag_exists=false"
    } >>"$GITHUB_OUTPUT"
  fi
  exit 0
fi

# --- Decide ------------------------------------------------------------------
# All tags are handed to the comparator, which partitions them by channel itself.
TAGS="$(git -C "$ROOT_DIR" tag --list 'v*' || true)"

DECISION="$(printf '%s' "$TAGS" | node -e "
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', async () => {
    const { pathToFileURL } = await import('node:url');
    const m = await import(pathToFileURL(process.argv[1]).href);
    const tags = chunks.join('').split('\n').map((s) => s.trim()).filter(Boolean);
    const d = m.decideRelease({
      version: process.argv[2],
      channel: process.argv[3],
      tags
    });
    process.stdout.write(JSON.stringify(d));
  });
" "$ROOT_DIR/scripts/lib/version-compare.mjs" "$VERSION" "$CHANNEL")"

SHOULD_RELEASE="$(node -p "JSON.parse(process.argv[1]).shouldRelease" "$DECISION")"
REASON="$(node -p "JSON.parse(process.argv[1]).reason" "$DECISION")"
BASELINE="$(node -p "JSON.parse(process.argv[1]).baseline ?? '<none>'" "$DECISION")"
TAG_EXISTS="$(node -p "JSON.parse(process.argv[1]).tagExists" "$DECISION")"
# Take the normalized version/tag from the DECISION, not from the raw input: a
# manual `VERSION=v1.2.3` would otherwise report `tag=vv1.2.3` while the decision
# was made on `1.2.3`.
VERSION="$(node -p "JSON.parse(process.argv[1]).version" "$DECISION")"
TAG="$(node -p "JSON.parse(process.argv[1]).tag" "$DECISION")"

# --- Report ------------------------------------------------------------------
echo "package version : $VERSION"
echo "branch          : ${BRANCH:-<unknown>}"
echo "channel         : $CHANNEL"
echo "baseline tag    : $BASELINE"
echo "tag to create   : $TAG"
echo "tag exists      : $TAG_EXISTS"
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
    echo "channel=$CHANNEL"
    echo "tag_exists=$TAG_EXISTS"
  } >>"$GITHUB_OUTPUT"
fi

exit 0
