// CHANGELOG.md section parser, shared by the CI release body
// (scripts/release-notes.mjs, plain Node) and the in-app What's new dialog
// (src/lib/changelog/releaseNotes.ts). Plain JS + JSDoc so both can import it.
//
// Format (see CHANGELOG.md's header): one `## <version> — <date>` section per
// release, newest first; inside, `### New` / `### Improved` / `### Fixed` /
// `### Removed` headings with `- **Title**: description` bullets.

/** @param {string} s */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @param {string} md */
function normalize(md) {
  return String(md ?? '').replace(/\r\n?/g, '\n');
}

/**
 * The body of the `## <version>` section: everything after its heading line up
 * to the next `## ` heading (or end of file), trimmed. `''` when absent. A
 * leading `v` on `version` and any trailing text on the heading line (the date)
 * are ignored; the version must match whole (`0.4` never matches `0.4.0`).
 * @param {string} md
 * @param {string} version
 * @returns {string}
 */
export function sectionFor(md, version) {
  const v = String(version ?? '').trim().replace(/^v/, '');
  if (!md || !v) return '';
  // Heading may be `## 1.2.3`, `## v1.2.3`, or the legacy `## [1.2.3]`.
  const re = new RegExp(
    '^## \\[?v?' + escapeRe(v) + '\\]?(?=\\s|$)[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))',
    'm'
  );
  const m = normalize(md).match(re);
  return m ? m[1].trim() : '';
}

/**
 * The first `## <version>` section (the newest release), for dev builds that
 * have no release version of their own. `null` when the file has none.
 * @param {string} md
 * @returns {{ version: string, body: string } | null}
 */
export function newestSection(md) {
  const m = normalize(md).match(/^## \[?v?([^\s\]]+)\]?/m);
  if (!m) return null;
  return { version: m[1], body: sectionFor(md, m[1]) };
}

/**
 * @typedef {{ kind: 'text' | 'bold' | 'code', text: string } | { kind: 'link', text: string, href: string }} Run
 * @typedef {{ heading: string, items: Run[][] }} NoteGroup
 */

/**
 * Split one bullet's text into inline runs: `**bold**`, `` `code` `` and
 * `[text](href)`; everything else is plain text.
 * @param {string} text
 * @returns {Run[]}
 */
export function parseInline(text) {
  /** @type {Run[]} */
  const runs = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) runs.push({ kind: 'text', text: text.slice(last, idx) });
    if (m[1] !== undefined) runs.push({ kind: 'bold', text: m[1] });
    else if (m[2] !== undefined) runs.push({ kind: 'code', text: m[2] });
    else runs.push({ kind: 'link', text: m[3], href: m[4] });
    last = idx + m[0].length;
  }
  if (last < text.length) runs.push({ kind: 'text', text: text.slice(last) });
  return runs;
}

/**
 * Parse a section body into `### ` heading groups of bullet items. Bullets
 * before the first heading land in a group with an empty heading; a bullet's
 * indented continuation lines are joined into it; non-bullet prose is ignored;
 * groups without bullets are dropped.
 * @param {string} body
 * @returns {NoteGroup[]}
 */
export function parseNotes(body) {
  /** @type {NoteGroup[]} */
  const groups = [];
  /** @type {NoteGroup} */
  let current = { heading: '', items: [] };
  /** @type {string[] | null} */
  let bullet = null;
  const flushBullet = () => {
    if (bullet) {
      const runs = parseInline(bullet.join(' '));
      if (runs.length) current.items.push(runs); // a bare `- ` renders nothing
    }
    bullet = null;
  };
  const flushGroup = () => {
    flushBullet();
    if (current.items.length) groups.push(current);
  };
  for (const raw of normalize(body).split('\n')) {
    const h = raw.match(/^###\s+(.+?)\s*$/);
    if (h) {
      flushGroup();
      current = { heading: h[1], items: [] };
      continue;
    }
    const b = raw.match(/^\s*[-*]\s+(.*)$/);
    if (b) {
      flushBullet();
      bullet = [b[1].trim()];
      continue;
    }
    // Continuation of the open bullet: an indented line, or (Markdown lazy
    // continuation, how an 80-column hard wrap comes out) any non-blank line
    // directly following it. A blank line ends the bullet.
    if (bullet && raw.trim()) {
      bullet.push(raw.trim());
      continue;
    }
    flushBullet();
  }
  flushGroup();
  return groups;
}
