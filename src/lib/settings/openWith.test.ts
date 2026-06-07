import { describe, expect, it } from 'vitest';
import {
  classify,
  resolveApp,
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

  it('returns undefined (system default) when the bucket is SYSTEM', () => {
    expect(resolveApp(prefs, 'photo.png')).toBeUndefined();
  });

  it('treats all-system defaults as system everywhere', () => {
    expect(resolveApp(DEFAULT_PREFS, 'index.html')).toBeUndefined();
    expect(resolveApp(DEFAULT_PREFS, 'main.ts')).toBeUndefined();
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
