import { describe, expect, it } from 'vitest';
import { escapeHtml, renderMarkdown } from './markdown';

// Tests for the minimal SAFE Markdown renderer (workflow-board STAGE 2). The board
// renders next.sh's Markdown stdout via this function + {@html}; these assert both
// the supported block/inline grammar AND — load-bearing — that untrusted source
// markup (raw tags, javascript: links) is escaped/neutralized, never passed
// through. The actual rendered visual is MANUAL.

describe('markdown — html escaping (safety)', () => {
  it('escapes the html-significant characters', () => {
    expect(escapeHtml('<u>x</u> & "q" \'s\'')).toBe(
      '&lt;u&gt;x&lt;/u&gt; &amp; &quot;q&quot; &#39;s&#39;'
    );
  });

  it('neutralizes raw html / script in the source', () => {
    const out = renderMarkdown('Hello <script>alert(1)</script> world');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('strips the raw <u> tags next.sh emits, keeping the text', () => {
    const out = renderMarkdown('## ***<u>In Progress</u>***');
    expect(out).toContain('<h2>');
    expect(out).not.toContain('<u>');
    expect(out).toContain('&lt;u&gt;In Progress&lt;/u&gt;');
  });

  it('only emits http(s)/mailto links; drops javascript: targets', () => {
    const ok = renderMarkdown('[site](https://example.com)');
    expect(ok).toContain('<a href="https://example.com"');
    expect(ok).toContain('rel="noopener noreferrer"');

    const evil = renderMarkdown('[x](javascript:alert(1))');
    expect(evil).not.toContain('<a ');
    expect(evil).not.toContain('javascript:');
    expect(evil).toContain('x'); // renders as plain text
  });
});

describe('markdown — block grammar', () => {
  it('renders ATX headings at the right level', () => {
    expect(renderMarkdown('# What’s Next')).toMatch(/^<h1>.*<\/h1>$/);
    expect(renderMarkdown('### Sub')).toBe('<h3>Sub</h3>');
  });

  it('renders inline bold / italic / code', () => {
    expect(renderMarkdown('**b** *i* `c`')).toBe(
      '<p><strong>b</strong> <em>i</em> <code>c</code></p>'
    );
  });

  it('renders a GFM pipe table', () => {
    const src = ['| Key | Item |', '|-----|------|', '| SKIPA-1 | Do it |'].join('\n');
    const out = renderMarkdown(src);
    expect(out).toContain('<table>');
    expect(out).toContain('<th>Key</th>');
    expect(out).toContain('<th>Item</th>');
    expect(out).toContain('<td>SKIPA-1</td>');
    expect(out).toContain('<td>Do it</td>');
  });

  it('renders bold cells inside a table (next.sh bolds the user’s rows)', () => {
    const src = ['| Key |', '|-----|', '| **SKIPA-9** |'].join('\n');
    const out = renderMarkdown(src);
    expect(out).toContain('<td><strong>SKIPA-9</strong></td>');
  });

  it('renders bullet lists', () => {
    const out = renderMarkdown('- one\n- two');
    expect(out).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('wraps loose text in paragraphs and separates on blank lines', () => {
    const out = renderMarkdown('para one\n\npara two');
    expect(out).toBe('<p>para one</p>\n<p>para two</p>');
  });

  it('does not throw on empty / whitespace input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('\n\n   \n')).toBe('');
  });
});
