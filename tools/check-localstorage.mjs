#!/usr/bin/env node
// localStorage usage gate.
//
// WHY: WKWebView (the Tauri webview on macOS) buffers localStorage in memory and
// only flushes it lazily, so an abrupt exit — `Ctrl-C` on `tauri dev`, a
// hot-reload, a crash, a force-quit — drops un-flushed writes and the value
// "forgets" on the next launch. Durable preferences must therefore go through the
// Rust-backed `settings.json` (see `src/lib/settings/uiPrefs.svelte.ts`), which is
// written atomically the moment a value changes.
//
// localStorage stays allowed ONLY for genuinely regenerable session caches: a lost
// cache simply recomputes from the transcript, so the lazy flush is harmless.
// This gate fails the build if any file OUTSIDE the allowlist reaches for
// localStorage, so new non-cache stores can't quietly reintroduce the bug.
//
// Run by the pre-commit hook and `npm run check:gate`.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SRC_DIR = join(REPO_ROOT, 'src');

// Files permitted to use localStorage: regenerable, sessionId-keyed caches that
// self-heal on a miss. Keep this list SHORT and justify every addition — durable
// state belongs in settings.json (uiPrefs), not here.
const ALLOWLIST = new Set([
  'src/lib/overview/titles.svelte.ts', // session-title cache (re-derives from transcript)
  'src/lib/overview/summaries.svelte.ts', // last-summary cache (re-derives from transcript)
  'src/lib/overview/costs.svelte.ts' // per-session cost cache (re-derives from snapshots)
]);

// Flag ANY reference to the `localStorage` identifier in code — property access
// (`localStorage.setItem`), index access (`localStorage[k]`), aliasing
// (`const ls = localStorage`), and `window.`/`globalThis.` prefixes all match the
// bare word. Comments are stripped first (see below) so prose mentioning
// localStorage in a `//`/`*` comment does not trip the gate.
const ACCESS = /\blocalStorage\b/;

/** Recursively collect source files under `dir` (skip node_modules / build / tests). */
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.svelte-kit' || name === 'build') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      collect(full, out);
    } else if (/\.(ts|js|svelte)$/.test(name) && !/\.(test|spec)\.[tj]s$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];
for (const file of collect(SRC_DIR)) {
  const rel = relative(REPO_ROOT, file);
  if (ALLOWLIST.has(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Skip whole-line comments (`//`, JSDoc `*`, block opener `/*`), so prose
    // mentioning localStorage doesn't trip the gate.
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    // Strip a trailing line comment so `code(); // localStorage…` doesn't false-
    // positive; the leading code on the line is still checked.
    const ci = line.indexOf('//');
    const code = ci >= 0 ? line.slice(0, ci) : line;
    if (ACCESS.test(code)) violations.push(`${rel}:${i + 1}: ${trimmed}`);
  });
}

if (violations.length > 0) {
  console.error('localStorage gate: FAIL\n');
  console.error('These files use localStorage but are not on the regenerable-cache');
  console.error('allowlist. Durable preferences must use the settings.json tier');
  console.error('(see src/lib/settings/uiPrefs.svelte.ts) — localStorage is not');
  console.error('reliably flushed by WKWebView on an abrupt restart.\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    `\nIf this really is a regenerable cache, add its path to ALLOWLIST in ${relative(REPO_ROOT, fileURLToPath(import.meta.url))}.`
  );
  process.exit(1);
}

console.log(`localStorage gate: OK (${ALLOWLIST.size} cache files allowlisted, no other usage)`);
