#!/usr/bin/env node
// Prints the CHANGELOG.md section for one version — the GitHub Release body.
//
//   node scripts/release-notes.mjs v1.2.3     (or 1.2.3)
//
// Exits 1 with an empty stdout when the section is missing, so the release
// gate fails loudly BEFORE it commits or tags — a version whose notes were never
// written is not burned. The parser is shared with the in-app What's new dialog
// (src/lib/changelog/section.mjs), so the app shows exactly what GitHub shows.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sectionFor } from '../src/lib/changelog/section.mjs';

const version = String(process.argv[2] ?? '').trim().replace(/^v/, '');
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version|vversion>');
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const body = sectionFor(md, version);
if (!body) {
  console.error(
    `CHANGELOG.md has no "## ${version}" section. Write the release notes for v${version} (see CHANGELOG.md's header for the format) before releasing.`
  );
  process.exit(1);
}
process.stdout.write(body + '\n');
