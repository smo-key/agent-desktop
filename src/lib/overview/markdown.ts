// Minimal, dependency-free Markdown → sanitized HTML for the overview transcript
// preview. Assistant message text is escaped FIRST, so the only tags that can
// appear in the output are the ones THIS module emits — no HTML/script injection
// from transcript content, which makes the result safe to render via {@html}.
//
// Scope is deliberately the small subset that shows up in an 8-line agent preview:
// headings, bold/italic, inline code, fenced code blocks, list items, blockquotes,
// links, and — the headline feature — FILENAME LINKIFICATION: a path-like token
// (`src/lib/foo.ts`, `Cargo.toml`) becomes a blue, clickable `md-file` button the
// card opens in the editor. Kept pure + framework-free so it is unit-tested.

/** Code-file extensions a token must end in to be treated as a clickable file. */
const FILE_EXT =
  'tsx?|jsx?|mjs|cjs|rs|svelte|json|md|py|css|scss|html?|toml|ya?ml|sh|go|rb|java|kt|c|h|cc|cpp|hpp|sql|txt|lock|env|cfg|ini';

/** A path-like token ending in a known code extension (optionally with dirs). */
const FILE_RE = new RegExp(
  `(?<![\\w./-])((?:[\\w.-]+/)*[\\w.-]+\\.(?:${FILE_EXT}))(?![\\w./-])`,
  'g'
);

/** Escape the HTML-significant characters so escaped text can be safely emitted. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Wrap path-like tokens (already HTML-escaped) as clickable file buttons. */
function linkifyFiles(escaped: string): string {
  return escaped.replace(
    FILE_RE,
    (m) => `<button type="button" class="md-file" data-file="${m}">${m}</button>`
  );
}

/** Inline formatting on an ALREADY HTML-ESCAPED line: code spans first (their
 *  contents are not further formatted except file links), then links, then
 *  bold/italic, then bare filenames. */
function inline(escaped: string): string {
  // Inline code: `code` — linkify filenames inside, but no other formatting.
  let out = escaped.replace(/`([^`]+)`/g, (_m, code) => `<code>${linkifyFiles(code)}</code>`);
  // Links: [text](url) — url is escaped already; restrict scheme to http(s).
  out = out.replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g, (_m, text, url) => `<a href="${url}" target="_blank" rel="noreferrer">${text}</a>`);
  // Bold then italic (bold first so ** isn't eaten by *).
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  // Bare filenames in the remaining (non-code) text.
  out = linkifyFiles(out);
  return out;
}

/**
 * Render a Markdown string to a sanitized HTML string for the transcript preview.
 * Block-level: fenced code, ATX headings, blockquotes, unordered/ordered lists,
 * and paragraphs (blank-line separated; single newlines become <br>).
 */
export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  let para: string[] = [];
  let list: string[] | null = null;

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${para.map((l) => inline(escapeHtml(l))).join('<br>')}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      html.push(`<ul>${list.map((l) => `<li>${inline(escapeHtml(l))}</li>`).join('')}</ul>`);
      list = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block: ```lang ... ```
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      flushPara();
      flushList();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      html.push(`<pre><code>${body.map((b) => linkifyFiles(escapeHtml(b))).join('\n')}</code></pre>`);
      continue;
    }

    // ATX heading: #..###### text
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head) {
      flushPara();
      flushList();
      const lvl = Math.min(head[1].length, 6);
      html.push(`<h${lvl}>${inline(escapeHtml(head[2].trim()))}</h${lvl}>`);
      i++;
      continue;
    }

    // Blockquote
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushPara();
      flushList();
      html.push(`<blockquote>${inline(escapeHtml(quote[1]))}</blockquote>`);
      i++;
      continue;
    }

    // List item (- * +, or ordered N.)
    const item = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (item) {
      flushPara();
      (list ??= []).push(item[1]);
      i++;
      continue;
    }

    // Blank line: paragraph/list break.
    if (line.trim() === '') {
      flushPara();
      flushList();
      i++;
      continue;
    }

    // Plain text line → accumulate into the current paragraph.
    flushList();
    para.push(line);
    i++;
  }
  flushPara();
  flushList();
  return html.join('');
}
