import { describe, expect, it } from 'vitest';
import { renderMarkdown, escapeHtml } from './markdown';

// Pure renderer tests: the preview escapes first (no injection), formats a small
// Markdown subset, and linkifies path-like filenames into clickable `.md-file`
// buttons the card opens in the editor.

describe('renderMarkdown', () => {
  it('escapes HTML so transcript text cannot inject', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
    const html = renderMarkdown('a <img src=x onerror=1> b');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('formats bold, italic and inline code', () => {
    expect(renderMarkdown('**bold** and *em* and `code`')).toBe(
      '<p><strong>bold</strong> and <em>em</em> and <code>code</code></p>'
    );
  });

  it('renders headings, lists and fenced code', () => {
    expect(renderMarkdown('# Title')).toBe('<h1>Title</h1>');
    expect(renderMarkdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
    const fence = renderMarkdown('```ts\nconst x = 1\n```');
    expect(fence).toBe('<pre><code>const x = 1</code></pre>');
  });

  it('linkifies a filename into a clickable md-file button', () => {
    const html = renderMarkdown('edited src/lib/auth.ts just now');
    expect(html).toContain('<button type="button" class="md-file" data-file="src/lib/auth.ts">src/lib/auth.ts</button>');
  });

  it('linkifies a filename inside inline code', () => {
    const html = renderMarkdown('see `Cargo.toml`');
    expect(html).toContain('class="md-file" data-file="Cargo.toml"');
  });

  it('does not linkify version numbers or prose', () => {
    const html = renderMarkdown('Opus 4.8 is great, e.g. really');
    expect(html).not.toContain('md-file');
  });
});
