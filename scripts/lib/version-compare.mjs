// Version math for the release gate — pure, dependency-free, and unit-tested
// (`version-compare.test.mjs`). Plain `.mjs` + JSDoc so `scripts/release-gate.sh`
// can `node -e`/`node -p` straight into it; node is already a hard requirement of
// that script.
//
// This replaces the gate's previous shell `semver_cmp`, which truncated a version
// at the first `-`/`+`. That was not just insufficient for a prerelease lane — it
// broke the STABLE lane the moment any prerelease tag existed:
//
//     tags: v0.3.2, v0.4.0-beta.1   package.json on main: 0.4.0
//     highest v* tag (-v:refname)   -> v0.4.0-beta.1
//     truncating compare            -> "0.4.0" vs "0.4.0" -> equal
//     => should_release=false, silently, forever
//
// So: full semver precedence (SemVer 2.0.0 §11), and a tag space PARTITIONED by
// channel so the two lanes cannot shadow each other.

/**
 * @typedef {{ major: number, minor: number, patch: number, prerelease: string[] }} ParsedVersion
 */

/** SemVer core + optional prerelease + optional build metadata. */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * Parse a semver string (an optional leading `v` is tolerated, build metadata is
 * discarded — SemVer §10: it takes no part in precedence).
 * @param {string} v
 * @returns {ParsedVersion | null} `null` when `v` is not valid semver.
 */
export function parseVersion(v) {
  const s = String(v ?? '')
    .trim()
    .replace(/^v/, '');
  const m = SEMVER_RE.exec(s);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : []
  };
}

/** Whether `v` is a valid semver version carrying a prerelease suffix. */
export function isPrerelease(v) {
  const p = parseVersion(v);
  return p !== null && p.prerelease.length > 0;
}

/** A prerelease identifier is numeric iff it is all digits (and so has no
 *  leading zero, which the grammar already rejects). */
function isNumericId(id) {
  return /^\d+$/.test(id);
}

/**
 * Compare two prerelease identifier lists per SemVer §11.4: numeric identifiers
 * compare numerically, alphanumeric ones compare in ASCII order, numeric always
 * ranks LOWER than alphanumeric, and when one list is a prefix of the other the
 * longer one ranks higher.
 * @param {string[]} a
 * @param {string[]} b
 */
function comparePrerelease(a, b) {
  // §11.3: a version WITH a prerelease ranks lower than one without.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    const xn = isNumericId(x);
    const yn = isNumericId(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn) return -1;
    if (yn) return 1;
    return x < y ? -1 : 1;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/**
 * Full semver precedence compare. Returns `-1` / `0` / `1`, or `null` when either
 * side is not valid semver (callers decide what an unparseable input means rather
 * than silently treating it as `0.0.0`).
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1 | null}
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (const k of /** @type {const} */ (['major', 'minor', 'patch'])) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  return /** @type {-1 | 0 | 1} */ (comparePrerelease(pa.prerelease, pb.prerelease));
}

/**
 * The highest `v*` tag in `tags`, restricted to one side of the channel
 * partition. Unparseable tags are ignored rather than defaulting to `0.0.0`, so a
 * hand-made tag like `v-old` can never become the baseline.
 *
 * @param {string[]} tags All existing tags (with or without a leading `v`).
 * @param {{ prerelease?: 'only' | 'exclude' | 'any' }} [opts]
 *   `'exclude'` (the stable baseline) considers only suffix-free versions;
 *   `'only'` considers only prereleases; `'any'` (the beta baseline) considers all.
 * @returns {string | null} The winning tag as given, or `null` when none qualify.
 */
export function highestTag(tags, opts = {}) {
  const mode = opts.prerelease ?? 'any';
  let best = null;
  let bestVersion = null;
  for (const tag of tags ?? []) {
    const parsed = parseVersion(tag);
    if (!parsed) continue;
    const pre = parsed.prerelease.length > 0;
    if (mode === 'exclude' && pre) continue;
    if (mode === 'only' && !pre) continue;
    const version = String(tag).trim().replace(/^v/, '');
    if (bestVersion === null || compareVersions(version, bestVersion) === 1) {
      best = tag;
      bestVersion = version;
    }
  }
  return best;
}

/** The release channels, and which branch each one releases from. */
export const CHANNELS = /** @type {const} */ (['stable', 'beta']);

/**
 * Map a git branch name to its release channel. Anything other than the two
 * release branches yields `null` — the caller treats that as "not a release
 * branch".
 * @param {string} branch
 * @returns {'stable' | 'beta' | null}
 */
export function channelForBranch(branch) {
  const b = String(branch ?? '').trim();
  if (b === 'main') return 'stable';
  if (b === 'beta') return 'beta';
  return null;
}

/**
 * @typedef {object} ReleaseDecision
 * @property {boolean} shouldRelease
 * @property {string} version   The version considered.
 * @property {string} tag       `v<version>`.
 * @property {'stable'|'beta'} channel
 * @property {string|null} baseline  The tag this version had to beat, if any.
 * @property {string} reason    Human-readable explanation, logged by the gate.
 */

/**
 * Decide whether a release is due, with the tag space partitioned by channel.
 *
 * - **stable** — the version must be suffix-free, and strictly greater than the
 *   highest SUFFIX-FREE tag. Prerelease tags are ignored entirely, so a live beta
 *   lane can never stall the stable lane.
 * - **beta** — the version must carry a prerelease suffix, and be strictly
 *   greater than the highest tag on EITHER lane, so a beta that is already
 *   superseded by a shipped stable release is never published.
 *
 * A version whose form does not match the channel is a no-op with a mismatch
 * reason (not an error): pushing a prerelease to `main`, or a plain version to
 * `beta`, must not fail the workflow.
 *
 * @param {{ version: string, channel: 'stable'|'beta', tags: string[] }} input
 * @returns {ReleaseDecision}
 */
export function decideRelease({ version, channel, tags }) {
  const v = String(version ?? '').trim().replace(/^v/, '');
  const tag = `v${v}`;
  const base = { version: v, tag, channel, baseline: null };

  const parsed = parseVersion(v);
  if (!parsed) {
    return { ...base, shouldRelease: false, reason: `'${v}' is not a valid semver version` };
  }
  if (channel !== 'stable' && channel !== 'beta') {
    return { ...base, shouldRelease: false, reason: `unknown release channel '${channel}'` };
  }

  const all = tags ?? [];
  if (all.some((t) => String(t).trim() === tag)) {
    return {
      ...base,
      shouldRelease: false,
      reason: `tag ${tag} already exists (idempotent: no re-release)`
    };
  }

  const pre = parsed.prerelease.length > 0;
  if (channel === 'stable' && pre) {
    return {
      ...base,
      shouldRelease: false,
      reason: `version ${v} is a prerelease; the stable lane releases only suffix-free versions (push it to the beta branch instead)`
    };
  }
  if (channel === 'beta' && !pre) {
    return {
      ...base,
      shouldRelease: false,
      reason: `version ${v} has no prerelease suffix; the beta lane releases only prereleases such as ${v}-beta.1`
    };
  }

  // stable measures itself against stable tags only; beta must clear both lanes.
  const baseline = highestTag(all, { prerelease: channel === 'stable' ? 'exclude' : 'any' });
  const baselineVersion = baseline ? String(baseline).trim().replace(/^v/, '') : '0.0.0';
  const cmp = compareVersions(v, baselineVersion);

  if (cmp === 1) {
    return {
      ...base,
      baseline,
      shouldRelease: true,
      reason: `version ${v} > baseline ${baseline ?? '<none>'} (${baselineVersion})`
    };
  }
  return {
    ...base,
    baseline,
    shouldRelease: false,
    reason:
      cmp === 0
        ? `version ${v} equals baseline ${baseline ?? '<none>'} (no bump)`
        : `version ${v} is not greater than baseline ${baseline ?? '<none>'} (${baselineVersion})`
  };
}
