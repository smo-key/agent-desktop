// Minimal, SAFE Markdown -> HTML renderer for the Workflow board (workflow-board
// STAGE 2). The board renders `next.sh`'s Markdown stdout directly (spec: Render
// next.sh Markdown Output Directly). `next.sh` emits a small, predictable subset —
// `#`/`##` headings, GFM pipe tables, **bold** / *italic* / `code` inline spans,
// links, and `-` bullet lists — plus the occasional raw `<u>…</u>` tag.
//
// SAFETY is the priority: the input is untrusted script output, so we HTML-escape
// every source character FIRST, then re-introduce a fixed, closed set of safe tags
// ourselves. No raw HTML from the source is ever passed through — an injected
// `<script>` or `<img onerror=…>` becomes inert text. Links are restricted to
// http(s)/mailto and `rel`-hardened. The result is assigned via `{@html}` in the
// component, which is safe precisely because this function is the only producer and
// it never emits attacker-controlled tags/attributes.
//
// This is a deliberately small renderer (not a CommonMark engine); it is pure and
// unit-tested (markdown.test.ts). Anything it doesn't recognize degrades to escaped
// paragraph text — never an error, never executable markup.

/** Escape the five HTML-significant characters so source markup is inert. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the INLINE spans of one already-HTML-escaped line: `code`, **bold**,
 * *italic*, and `[text](url)` links. Order matters — code first (so its contents
 * aren't re-processed), then links, then bold, then italic. Because the input is
 * pre-escaped, the markers we match (`*`, `` ` ``, `[`, `]`, `(`, `)`) are literal.
 */
function renderInline(escaped: string): string {
  let out = escaped;

  // `code` — non-greedy, no backticks inside.
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);

  // [text](url) — only http(s) and mailto targets; everything else renders as the
  // literal escaped text (no href) so we never emit a javascript:/data: link.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
    if (/^(https?:\/\/|mailto:)/i.test(url)) {
      // url came from escaped text; quotes are already entity-encoded.
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
    return text;
  });

  // **bold** then *italic* (bold first so `**` isn't eaten by the italic rule).
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, b) => `<strong>${b}</strong>`);
  out = out.replace(/\*([^*]+)\*/g, (_m, i) => `<em>${i}</em>`);

  return out;
}

/** True if a line looks like a GFM table row: starts and ends with a pipe. */
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.lastIndexOf('|') > 0;
}

/** True if a line is a GFM table delimiter row, e.g. `|---|:--:|`. */
function isTableDivider(line: string): boolean {
  const t = line.trim();
  if (!isTableRow(t)) return false;
  return splitRow(t).every((cell) => /^:?-{1,}:?$/.test(cell.trim()) && cell.trim() !== '');
}

/** Split a `| a | b |` row into its cell strings (drop the leading/trailing |). */
function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|');
}

/**
 * Render `src` (Markdown) to a safe HTML string. Block grammar: ATX headings
 * (`#`..`######`), GFM pipe tables, `-`/`*` bullet lists, and paragraphs; blank
 * lines separate blocks. Everything is escaped before any tag is introduced.
 */
export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];

  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    const inner = para.map((l) => renderInline(escapeHtml(l.trim()))).join('<br />');
    html.push(`<p>${inner}</p>`);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line: paragraph boundary.
    if (trimmed === '') {
      flushPara();
      i += 1;
      continue;
    }

    // ATX heading: 1-6 leading '#'s then a space.
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      const inner = renderInline(escapeHtml(heading[2].trim()));
      html.push(`<h${level}>${inner}</h${level}>`);
      i += 1;
      continue;
    }

    // GFM table: a header row, a divider row, then zero+ body rows.
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushPara();
      const headerCells = splitRow(line).map((c) => renderInline(escapeHtml(c.trim())));
      const body: string[][] = [];
      i += 2; // consume header + divider
      while (i < lines.length && isTableRow(lines[i]) && !isTableDivider(lines[i])) {
        body.push(splitRow(lines[i]).map((c) => renderInline(escapeHtml(c.trim()))));
        i += 1;
      }
      const thead = `<thead><tr>${headerCells.map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${body
        .map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      html.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Bullet list: consecutive `- ` / `* ` lines.
    if (/^[-*]\s+/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        const item = lines[i].trim().replace(/^[-*]\s+/, '');
        items.push(`<li>${renderInline(escapeHtml(item))}</li>`);
        i += 1;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Otherwise accumulate into the current paragraph.
    para.push(line);
    i += 1;
  }

  flushPara();
  return html.join('\n');
}
