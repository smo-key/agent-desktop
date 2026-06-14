import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Tauri `invoke` is mocked so `OpenWithStore.openFile` can be asserted without
// a live backend (mirrors uiPrefs/prActions tests). The pure helpers below don't
// touch it.
const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import {
  classify,
  resolveApp,
  isProjectAwareEditor,
  visibleChoices,
  appIcon,
  OpenWithStore,
  parsePrefs,
  DEFAULT_PREFS,
  SYSTEM,
  CUSTOM,
  type OpenWithPrefs
} from './openWith.svelte';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

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

describe('isProjectAwareEditor', () => {
  it('is true for the allowlisted project-aware editors', () => {
    for (const app of ['Cursor', 'Visual Studio Code', 'Zed', 'Sublime Text']) {
      expect(isProjectAwareEditor(app)).toBe(true);
    }
  });

  it('is false for non-project-aware apps, custom names, and System Default', () => {
    for (const app of ['TextEdit', 'Finder', 'Brave Browser', 'My Custom App']) {
      expect(isProjectAwareEditor(app)).toBe(false);
    }
    expect(isProjectAwareEditor(undefined)).toBe(false);
    expect(isProjectAwareEditor(null)).toBe(false);
  });
});

describe('visibleChoices', () => {
  const all = ['Cursor', 'Visual Studio Code', 'Zed', 'Sublime Text', 'TextEdit'];

  it('installed application is offered', () => {
    const got = visibleChoices(all, new Set(['Cursor', 'Zed']), SYSTEM);
    expect(got).toEqual(['Cursor', 'Zed']);
  });

  it('uninstalled application is hidden', () => {
    const got = visibleChoices(all, new Set(['Cursor']), SYSTEM);
    expect(got).toEqual(['Cursor']);
    expect(got).not.toContain('Visual Studio Code');
  });

  it('the saved application is kept even when not installed', () => {
    // 'Sublime Text' is not installed but is the saved preference → still listed.
    const got = visibleChoices(all, new Set(['Cursor']), 'Sublime Text');
    expect(got).toEqual(['Cursor', 'Sublime Text']);
  });

  it('choices preserve their curated order', () => {
    // Set iteration order differs from the curated order; the result follows `all`.
    const got = visibleChoices(all, new Set(['Zed', 'TextEdit', 'Cursor']), SYSTEM);
    expect(got).toEqual(['Cursor', 'Zed', 'TextEdit']);
  });

  it('no detection yields only the always present entries', () => {
    // Empty installed set + System Default → no curated apps at all.
    expect(visibleChoices(all, new Set(), SYSTEM)).toEqual([]);
    // …but a saved app is still retained.
    expect(visibleChoices(all, new Set(), 'Cursor')).toEqual(['Cursor']);
  });
});

describe('appIcon', () => {
  it('a known application shows its brand icon', () => {
    expect(appIcon('Cursor')).toBe('cursor');
    expect(appIcon('Visual Studio Code')).toBe('vscode');
    expect(appIcon('Google Chrome')).toBe('chrome');
    expect(appIcon('Firefox')).toBe('firefox');
  });

  it('an unknown or custom application shows a generic icon', () => {
    expect(appIcon('Some Random App')).toBe('app');
    expect(appIcon('')).toBe('app');
  });

  it('apps without a brand mark fall back by category', () => {
    expect(appIcon('Finder')).toBe('folder');
    expect(appIcon('TextEdit')).toBe('document');
  });

  it('system default and custom show their own icons', () => {
    expect(appIcon(SYSTEM)).toBe('system');
    expect(appIcon(CUSTOM)).toBe('custom');
  });
});

describe('OpenWithStore.openFile', () => {
  const withPrefs = (prefs: OpenWithPrefs): OpenWithStore => {
    const store = new OpenWithStore();
    store.prefs = prefs;
    return store;
  };
  const prefs: OpenWithPrefs = {
    code: 'Cursor',
    html: 'Brave Browser',
    markdown: 'Zed',
    other: 'TextEdit'
  };

  it('forwards the workspace to a project-aware editor', async () => {
    await withPrefs(prefs).openFile('/proj/src/a.ts', '/proj');
    expect(invokeMock).toHaveBeenLastCalledWith('open_path', {
      path: '/proj/src/a.ts',
      app: 'Cursor',
      workspace: '/proj'
    });
  });

  it('omits the workspace for a System Default category', async () => {
    await withPrefs(DEFAULT_PREFS).openFile('/proj/src/a.ts', '/proj');
    expect(invokeMock).toHaveBeenLastCalledWith('open_path', {
      path: '/proj/src/a.ts',
      app: null,
      workspace: null
    });
  });

  it('omits the workspace for a non-project-aware app', async () => {
    // `other` is "TextEdit" — a named app, but not a project-aware editor.
    await withPrefs(prefs).openFile('/proj/photo.png', '/proj');
    expect(invokeMock).toHaveBeenLastCalledWith('open_path', {
      path: '/proj/photo.png',
      app: 'TextEdit',
      workspace: null
    });
  });

  it('omits the workspace when none is supplied', async () => {
    await withPrefs(prefs).openFile('/proj/src/a.ts');
    expect(invokeMock).toHaveBeenLastCalledWith('open_path', {
      path: '/proj/src/a.ts',
      app: 'Cursor',
      workspace: null
    });
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
