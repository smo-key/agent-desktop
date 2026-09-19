// (Deliberately no shebang: this module is imported by beta-manifest.test.mjs,
// and Windows CI checks out with core.autocrlf=true. A shebang whose line ends
// in CRLF makes the loader emit invalid JS — `SyntaxError: Invalid or
// unexpected token` — which failed the whole quality gate on v0.4.0-2. It is
// always run as `node scripts/beta-manifest.mjs`, so it never needed one.)
//
// Rewrite a beta release's `latest.json` so its download URLs point at the
// release's OWN tag.
//
//   node scripts/beta-manifest.mjs <latest.json> <tag>      # rewrite in place
//
// Why this exists: `tauri-action` writes every platform URL in the form
//
//     https://github.com/<owner>/<repo>/releases/latest/download/<asset>
//
// which assumes the release it just built becomes `releases/latest`. For a BETA
// that assumption is false by construction — a beta is published as a prerelease
// precisely so it does NOT become `releases/latest`, which keeps stable users on
// stable builds. So `releases/latest/download/<beta asset>` resolves to the newest
// STABLE release, which does not contain that asset, and returns 404.
//
// Verified against the real v0.4.0-1 release:
//     .../releases/latest/download/Agent.Desktop_0.4.0-1_x64-setup.exe -> 404
//     .../releases/download/v0.4.0-1/Agent.Desktop_0.4.0-1_x64-setup.exe -> 200
//
// The updater reports a failed bundle download as a retryable "Update failed"
// pill, so without this every beta update would find the update, then fail to
// install it, forever.
//
// The STABLE manifest is left exactly as tauri-action writes it: there
// `releases/latest` is correct and is what lets an older stable build resolve the
// newest one.
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Rewrite `/releases/latest/download/<asset>` to `/releases/download/<tag>/<asset>`
 * in every platform entry of an updater manifest. PURE: returns a new object and
 * does not touch the input.
 *
 * Entries already pointing at a specific tag are left alone, so this is
 * idempotent and safe to run twice. Anything that is not a recognizable
 * `releases/latest/download` URL is passed through untouched rather than
 * rewritten by guesswork.
 *
 * @param {any} manifest  The parsed `latest.json`.
 * @param {string} tag    The release tag, e.g. `v0.4.0-1`.
 * @returns {{ manifest: any, rewritten: number, skipped: number }}
 */
export function pinManifestToTag(manifest, tag) {
  const t = String(tag ?? '').trim();
  if (!t) throw new Error('a release tag is required');
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('manifest must be an object');
  }
  const platforms = manifest.platforms;
  if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) {
    throw new Error('manifest has no platforms object');
  }

  let rewritten = 0;
  let skipped = 0;
  const out = { ...manifest, platforms: {} };
  for (const [key, entry] of Object.entries(platforms)) {
    if (!entry || typeof entry !== 'object' || typeof entry.url !== 'string') {
      out.platforms[key] = entry;
      skipped++;
      continue;
    }
    const next = entry.url.replace(
      /\/releases\/latest\/download\//,
      `/releases/download/${encodeURIComponent(t)}/`
    );
    if (next === entry.url) skipped++;
    else rewritten++;
    out.platforms[key] = { ...entry, url: next };
  }
  return { manifest: out, rewritten, skipped };
}

// CLI: rewrite in place and report, so the workflow log shows what changed.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, tag] = process.argv.slice(2);
  if (!file || !tag) {
    console.error('usage: node scripts/beta-manifest.mjs <latest.json> <tag>');
    process.exit(2);
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const { manifest, rewritten, skipped } = pinManifestToTag(parsed, tag);
  if (rewritten === 0) {
    console.error(
      `ERROR: no platform URL in ${file} matched /releases/latest/download/ — refusing to publish a beta manifest whose download URLs were not pinned to ${tag}.`
    );
    process.exit(1);
  }
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Pinned ${rewritten} platform URL(s) to ${tag} (${skipped} left as-is).`);
}
