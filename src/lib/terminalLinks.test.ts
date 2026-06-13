import { describe, expect, it } from 'vitest';
import { extractToken, normalizeToken, fileLinkAt, urlAt } from './terminalLinks';

// Tests for the PURE token helpers behind terminal file links (terminal-file-links
// spec: Token decoration stripping). They prove the load-bearing properties — the
// contiguous run is found, decorations are stripped, and the reported range hugs
// the cleaned path — without touching xterm or the filesystem (existence is the
// `resolve_path` backend's job, verified manually).

describe('extractToken', () => {
  it('returns the contiguous non-whitespace run under the column', () => {
    const line = 'edited src/lib/foo.ts now';
    const tok = extractToken(line, 10); // inside "src/lib/foo.ts"
    expect(tok).toEqual({ raw: 'src/lib/foo.ts', start: 7, end: 21 });
  });

  it('returns null on a whitespace-only / empty position', () => {
    expect(extractToken('a b', 1)).toBeNull(); // the space
    expect(extractToken('', 0)).toBeNull();
    expect(extractToken('abc', 5)).toBeNull(); // out of range
  });
});

describe('normalizeToken', () => {
  it('leaves a plain token untouched', () => {
    expect(normalizeToken('src/foo.ts')).toEqual({ text: 'src/foo.ts', start: 0, end: 10 });
  });

  it('strips a :line:col suffix', () => {
    const c = normalizeToken('src/foo.ts:42:8');
    expect(c.text).toBe('src/foo.ts');
    expect('src/foo.ts:42:8'.slice(c.start, c.end)).toBe('src/foo.ts');
  });

  it('strips surrounding quotes and trailing punctuation', () => {
    const c = normalizeToken('"README.md".');
    expect(c.text).toBe('README.md');
    expect('"README.md".'.slice(c.start, c.end)).toBe('README.md');
  });

  it('strips one layer of wrapping brackets', () => {
    expect(normalizeToken('(src/foo.ts)').text).toBe('src/foo.ts');
    expect(normalizeToken('[build]').text).toBe('build');
  });

  it('strips a stray trailing bracket and a quoted line suffix together', () => {
    expect(normalizeToken('foo.ts)').text).toBe('foo.ts');
    expect(normalizeToken('"foo.ts:42"').text).toBe('foo.ts');
  });

  it('keeps a :port-like suffix when stripLineCol is false (for URLs)', () => {
    // Default still strips the trailing `:3000`…
    expect(normalizeToken('http://localhost:3000').text).toBe('http://localhost');
    // …but opting out keeps it, so a host:port URL survives intact.
    expect(normalizeToken('http://localhost:3000', { stripLineCol: false }).text).toBe(
      'http://localhost:3000'
    );
    // Wrapping/punctuation peeling still applies when stripLineCol is false.
    expect(normalizeToken('(http://localhost:3000).', { stripLineCol: false }).text).toBe(
      'http://localhost:3000'
    );
  });
});

describe('urlAt', () => {
  it('linkifies an http(s) URL under the column', () => {
    const httpsLine = 'see https://example.com/docs for more';
    const https = urlAt(httpsLine, 8); // inside the URL
    expect(https?.text).toBe('https://example.com/docs');
    expect(httpsLine.slice(https!.start, https!.end)).toBe('https://example.com/docs');

    expect(urlAt('open http://localhost:8080/app now', 12)?.text).toBe('http://localhost:8080/app');
  });

  it('keeps a host:port URL with no path (does not strip :port as :line)', () => {
    expect(urlAt('http://localhost:3000', 5)?.text).toBe('http://localhost:3000');
  });

  it('strips surrounding brackets and trailing punctuation, hugging the URL', () => {
    const line = 'docs (https://example.com).';
    const link = urlAt(line, 10); // inside the URL
    expect(link?.text).toBe('https://example.com');
    expect(line.slice(link!.start, link!.end)).toBe('https://example.com');
  });

  it('returns null for a scheme-less token (a bare host or filename)', () => {
    expect(urlAt('visit example.com today', 8)).toBeNull();
    expect(urlAt('open notes.io now', 6)).toBeNull();
    expect(urlAt('cat src/foo.ts', 6)).toBeNull();
  });

  it('returns null on whitespace', () => {
    expect(urlAt('a b', 1)).toBeNull();
  });
});

describe('fileLinkAt', () => {
  it('reports the cleaned path range in line coordinates', () => {
    const line = 'see "src/foo.ts:42:8".';
    const link = fileLinkAt(line, 8); // inside the path
    expect(link?.text).toBe('src/foo.ts');
    // The reported range hugs only the path, not the quotes/suffix/period.
    expect(line.slice(link!.start, link!.end)).toBe('src/foo.ts');
  });

  it('returns null on whitespace', () => {
    expect(fileLinkAt('a b', 1)).toBeNull();
  });
});
