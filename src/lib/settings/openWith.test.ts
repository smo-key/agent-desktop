import { describe, expect, it } from 'vitest';
import {
  classify,
  resolveApp,
  workspaceRootFor,
  parsePrefs,
  DEFAULT_PREFS,
  SYSTEM,
  type OpenWithPrefs
} from './openWith.svelte';

// Tests for the PURE open-with logic: extension → bucket classification, bucket →
// app resolution under prefs, and tolerant parsing of persisted settings. The
// store's load/save (Tauri invoke) is exercised manually.

describe('classify', () => {
  it('routes .html/.htm to the html bucket', () => {
    expect(classify('/a/index.html')).toBe('html');
    expect(classify('page.HTM')).toBe('html');
  });

  it('routes source/text files to the code bucket', () => {
    for (const p of ['src/foo.ts', 'a.py', 'main.rs', 'notes.txt', 'style.css']) {
      expect(classify(p)).toBe('code');
    }
  });

  it('routes markdown files to the markdown bucket', () => {
    for (const p of ['README.md', 'docs/guide.markdown', 'page.mdx']) {
      expect(classify(p)).toBe('markdown');
    }
  });

  it('routes unknown/binary/extension-less and directories to other', () => {
    for (const p of ['photo.png', 'archive.zip', 'data.bin', '/some/dir', 'BINARYNOEXT']) {
      expect(classify(p)).toBe('other');
    }
  });

  it('recognizes well-known extension-less code files', () => {
    expect(classify('/repo/Dockerfile')).toBe('code');
    expect(classify('Makefile')).toBe('code');
  });

  it('ignores a leading dot (dotfiles are not extensions)', () => {
    expect(classify('/home/me/.gitignore')).toBe('other');
  });

  it('routes http/https URLs to the html bucket by scheme', () => {
    expect(classify('https://example.com/docs')).toBe('html');
    expect(classify('http://localhost:3000')).toBe('html');
    // The scheme wins over any extension in the URL path.
    expect(classify('https://example.com/app.css')).toBe('html');
    expect(classify('https://example.com/readme.md')).toBe('html');
  });
});

describe('resolveApp', () => {
  const prefs: OpenWithPrefs = {
    code: 'Cursor',
    html: 'Brave Browser',
    markdown: 'Zed',
    other: SYSTEM
  };

  it('returns the configured app for the file bucket', () => {
    expect(resolveApp(prefs, 'index.html')).toBe('Brave Browser');
    expect(resolveApp(prefs, 'main.ts')).toBe('Cursor');
    expect(resolveApp(prefs, 'README.md')).toBe('Zed');
  });

  it('opens an http(s) URL with the html-category app', () => {
    expect(resolveApp(prefs, 'https://example.com/docs')).toBe('Brave Browser');
  });

  it('returns undefined (system default) when the bucket is SYSTEM', () => {
    expect(resolveApp(prefs, 'photo.png')).toBeUndefined();
  });

  it('treats all-system defaults as system everywhere', () => {
    expect(resolveApp(DEFAULT_PREFS, 'index.html')).toBeUndefined();
    expect(resolveApp(DEFAULT_PREFS, 'main.ts')).toBeUndefined();
  });
});

describe('workspaceRootFor', () => {
  const prefs: OpenWithPrefs = {
    code: 'Cursor',
    html: 'Brave Browser',
    markdown: 'Zed',
    other: 'Finder'
  };

  it('returns the root for a code file opened in a workspace-capable editor', () => {
    expect(workspaceRootFor(prefs, '/proj/src/a.ts', '/proj')).toBe('/proj');
  });

  it('returns the root for a markdown file opened in a workspace-capable editor', () => {
    expect(workspaceRootFor(prefs, '/proj/README.md', '/proj')).toBe('/proj');
  });

  it('returns undefined when there is no root', () => {
    expect(workspaceRootFor(prefs, '/proj/src/a.ts', null)).toBeUndefined();
    expect(workspaceRootFor(prefs, '/proj/src/a.ts', '')).toBeUndefined();
  });

  it('returns undefined for non-editor buckets (html, other)', () => {
    expect(workspaceRootFor(prefs, '/proj/index.html', '/proj')).toBeUndefined();
    expect(workspaceRootFor(prefs, '/proj/photo.png', '/proj')).toBeUndefined();
  });

  it('returns undefined when the bucket is System Default (no app)', () => {
    expect(workspaceRootFor(DEFAULT_PREFS, '/proj/src/a.ts', '/proj')).toBeUndefined();
  });

  it('returns undefined when the editor is not workspace-capable (e.g. TextEdit)', () => {
    const p: OpenWithPrefs = { ...prefs, code: 'TextEdit' };
    expect(workspaceRootFor(p, '/proj/src/a.ts', '/proj')).toBeUndefined();
  });

  it('honors all known workspace-capable editors', () => {
    for (const app of ['Cursor', 'Visual Studio Code', 'Zed', 'Sublime Text']) {
      const p: OpenWithPrefs = { ...prefs, code: app };
      expect(workspaceRootFor(p, '/proj/src/a.ts', '/proj')).toBe('/proj');
    }
  });
});

describe('parsePrefs', () => {
  it('falls back to defaults on null / garbage', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
  });

  it('reads the openWith envelope', () => {
    const raw = JSON.stringify({
      openWith: { code: 'Cursor', html: 'Brave Browser', markdown: 'Zed', other: 'Cursor' }
    });
    expect(parsePrefs(raw)).toEqual({
      code: 'Cursor',
      html: 'Brave Browser',
      markdown: 'Zed',
      other: 'Cursor'
    });
  });

  it('also accepts a bare prefs object and fills missing buckets with defaults', () => {
    expect(parsePrefs(JSON.stringify({ html: 'Firefox' }))).toEqual({
      code: SYSTEM,
      html: 'Firefox',
      markdown: SYSTEM,
      other: SYSTEM
    });
  });
});
