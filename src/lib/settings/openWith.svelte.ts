// Open-with preferences: which application opens a file when the user ⌘-clicks a
// path in a terminal (or a transcript file link). Files fall into three buckets —
// HTML, code, and other — and each bucket maps to either the OS default ("system")
// or a named app launched via `open -a <app>` on the Rust side.
//
// Persistence mirrors the projects/recents stores: load once on startup from
// `settings.json`, save (best-effort) on every change. The pure classification
// helpers are exported for unit testing.

import { invoke } from '@tauri-apps/api/core';
import { loadSettings, saveSettingsSlice } from './persist';

/** A bucket a file path is classified into for open-with routing. */
export type FileBucket = 'code' | 'html' | 'markdown' | 'other';

/** The sentinel value meaning "use the OS default handler" (plain `open`). */
export const SYSTEM = 'system';

/** Per-bucket app preference: `SYSTEM` or a macOS app name (e.g. "Cursor"). */
export type OpenWithPrefs = Record<FileBucket, string>;

/**
 * Default preferences for a fresh install: every category is "System Default" (the
 * OS handler). Selecting an app in the Settings dialog overrides a category;
 * resetting it to "System Default" restores `SYSTEM`.
 */
export const DEFAULT_PREFS: OpenWithPrefs = {
  code: SYSTEM,
  html: SYSTEM,
  markdown: SYSTEM,
  other: SYSTEM
};

/** Common app groups, composed into the per-bucket choice lists below. */
const EDITORS = ['Cursor', 'Visual Studio Code', 'Zed', 'Sublime Text', 'TextEdit'];
const BROWSERS = ['Brave Browser', 'Google Chrome', 'Safari', 'Firefox', 'Arc', 'Microsoft Edge'];

/** Curated app choices per bucket for the settings dropdowns. "System Default" is
 *  prepended in the UI; "Custom…" lets the user type any installed app name. HTML
 *  offers browsers AND editors (the user may prefer to open markup in a code editor). */
export const APP_CHOICES: Record<FileBucket, string[]> = {
  code: EDITORS,
  html: [...BROWSERS, ...EDITORS],
  markdown: [...EDITORS, ...BROWSERS],
  other: [...EDITORS, 'Finder']
};

/** Extensions treated as HTML (open in the HTML/browser bucket). */
const HTML_EXTS = new Set(['html', 'htm', 'xhtml']);

/** Extensions treated as Markdown (its own bucket). */
const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx', 'mdown', 'mkd']);

/** Extensions treated as code/text (open in the code-editor bucket). Anything not
 *  here (and not HTML) — including binaries, archives, media, and directories —
 *  falls through to the "other" bucket. */
const CODE_EXTS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'json', 'jsonc',
  'css', 'scss', 'sass', 'less', 'html', // html also valid code, but HTML_EXTS wins
  'svelte', 'vue', 'astro',
  'py', 'rb', 'php', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'clj', 'cljs',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'm', 'mm', 'cs', 'swift', 'dart',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat',
  'sql', 'graphql', 'gql', 'proto',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'xml', 'svg', 'gradle',
  'rst', 'txt', 'text', 'log',
  'lua', 'r', 'jl', 'ex', 'exs', 'erl', 'hs', 'ml', 'pl', 'vim', 'el',
  'tf', 'hcl', 'dockerfile', 'makefile', 'cmake'
]);

/** PURE: classify an absolute or relative path into a bucket by its extension.
 *  Extension-less files and directories → `other`. */
export function classify(path: string): FileBucket {
  // Basename, then the extension after the last dot (ignore leading-dot dotfiles).
  const base = path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  // Some well-known extension-less code files (e.g. Dockerfile, Makefile).
  const lowerBase = base.toLowerCase();
  if (!ext && (lowerBase === 'dockerfile' || lowerBase === 'makefile')) return 'code';
  if (HTML_EXTS.has(ext)) return 'html';
  if (MARKDOWN_EXTS.has(ext)) return 'markdown';
  if (CODE_EXTS.has(ext)) return 'code';
  return 'other';
}

/** PURE: the app to open `path` with under `prefs`, or `undefined` for the OS
 *  default. A blank/`SYSTEM` bucket value means "system". */
export function resolveApp(prefs: OpenWithPrefs, path: string): string | undefined {
  const pref = prefs[classify(path)];
  if (!pref || pref === SYSTEM) return undefined;
  return pref;
}

/**
 * Reactive open-with preferences store. Singleton, imported by the settings modal
 * (read/write) and the terminal/transcript file-open paths (read via `openFile`).
 */
export class OpenWithStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<OpenWithPrefs>({ ...DEFAULT_PREFS });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** Load persisted prefs from `settings.json`. On a fresh install (no file) the
   *  all-"System Default" `DEFAULT_PREFS` apply. Never throws (bad JSON / non-Tauri
   *  → defaults). Call once on mount. */
  async load(): Promise<void> {
    // Read the shared settings blob and parse only our `openWith` slice. The
    // merge-aware persist helper never throws, so a fresh install / bad JSON /
    // non-Tauri env all yield `{}` → DEFAULT_PREFS (all System Default).
    const settings = await loadSettings();
    this.prefs = parsePrefs(settings.openWith);
    this.loaded = true;
  }

  /** Set one bucket's preference and persist (best-effort). */
  set(bucket: FileBucket, value: string): void {
    this.prefs = { ...this.prefs, [bucket]: value };
    void this.save();
  }

  /** Open `path` with the configured app for its bucket (or the OS default). */
  async openFile(path: string): Promise<void> {
    const app = resolveApp(this.prefs, path);
    try {
      await invoke('open_path', { path, app: app ?? null });
    } catch (err) {
      console.warn('open_path failed', err);
    }
  }

  /** Persist the current prefs as the `openWith` slice, merging into the shared
   *  settings blob so sibling slices (e.g. voice) are preserved (best-effort). */
  private async save(): Promise<void> {
    await saveSettingsSlice('openWith', this.prefs);
  }
}

/** PURE: parse persisted open-with prefs, tolerating any shape. Accepts either the
 *  already-parsed `openWith` slice (an object, the modern call from `load()`), a
 *  raw settings-JSON string (legacy / tests), or `null`. Unknown / missing buckets
 *  fall back to `DEFAULT_PREFS` (System Default). */
export function parsePrefs(raw: unknown): OpenWithPrefs {
  if (raw == null) return { ...DEFAULT_PREFS };
  let ow: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      const obj = JSON.parse(raw);
      ow = (obj?.openWith ?? obj ?? {}) as Record<string, unknown>;
    } catch {
      return { ...DEFAULT_PREFS };
    }
  } else if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    // Accept either the slice itself or a wrapping `{ openWith: … }` envelope.
    ow = ((obj.openWith ?? obj) as Record<string, unknown>) ?? {};
  } else {
    return { ...DEFAULT_PREFS };
  }
  const pick = (b: FileBucket): string => {
    const v = ow[b];
    return typeof v === 'string' && v.trim() ? v : DEFAULT_PREFS[b];
  };
  return {
    code: pick('code'),
    html: pick('html'),
    markdown: pick('markdown'),
    other: pick('other')
  };
}

/** The singleton open-with store. */
export const openWith = new OpenWithStore();
