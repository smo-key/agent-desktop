#!/usr/bin/env node
// Scenario-coverage gate (tasks.md 1.5).
//
// Parses every `#### Scenario:` heading under
//   openspec/changes/*/specs/**/*.md   (and openspec/specs/** once archived),
// normalizes each scenario title to snake_case, then scans the test corpus for a
// matching test name:
//   - Rust:   `fn <snake>(` in src-tauri/**/*.rs
//   - Vitest: it('<title>'…) / test('<title>'…) / describe('<title>'…) in src/**/*.{test,spec}.{ts,js}
// A scenario is COVERED iff its snake_case name appears as a Rust test fn or as a
// (snake-normalized) Vitest title.
//
// Milestone scoping: this gate ENFORCES exactly the capabilities listed in
// ENFORCED_CAPABILITIES (Milestone 1 => only `terminal-core`). Every other
// capability's scenarios are printed as KNOWN-PENDING (future milestones) and do
// NOT affect the exit code.
//
// Headless-exempt scenarios: a small allowlist of scenarios are inherently
// GPU/DOM/live-TUI bound and cannot be exercised by a headless automated test
// (no real WebGL context, no live xterm+PTY wiring, no window resize in CI).
// These are reported as MANUAL (needs live in-app confirmation) and do NOT fail
// the gate — but they are NEVER silently treated as passing automated coverage.
// They are listed explicitly so the human knows exactly what to confirm live.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// --- Milestone configuration -------------------------------------------------

// Milestone 1 enforces terminal-core. Milestone 2 adds tiling-layout and
// layout-persistence (all their pure-logic scenarios are now unit-tested).
const ENFORCED_CAPABILITIES = new Set([
  'terminal-core',
  'tiling-layout',
  'layout-persistence',
]);

// Scenarios that cannot be tested headless (GPU / DOM / live TUI). Keyed by
// capability -> set of snake_case scenario names. Reported as MANUAL, not failed.
const MANUAL_SCENARIOS = {
  'terminal-core': new Set([
    'webgl_loaded_for_a_visible_pane',
    'context_loss_falls_back_to_dom',
    'webgl_restricted_to_stay_under_the_context_ceiling',
    'reparenting_does_not_remount_the_terminal',
    'ordered_teardown_leaves_no_leaks',
  ]),
  // tiling-layout: every split/close/resize-math/focus/paneId-stability scenario
  // is a pure-tree unit test (enforced). What remains is genuinely live-DOM bound:
  // an actual workspace switch in the rendered tree, the runtime guarantee that a
  // live xterm is not remounted, and the mid-drag (real pointer gesture) variant
  // of that same no-remount guarantee. These need a real window + live xterm/PTY.
  'tiling-layout': new Set([
    'switch_to_another_workspace_via_the_rail',
    'switching_workspaces_does_not_remount_terminals',
    'resize_does_not_remount_terminals_mid_drag',
  ]),
  // layout-persistence: serialize/validate/migrate/respawn/fallback/debounce are
  // all enforced unit tests. Only the OPTIONAL addon-serialize scrollback repaint
  // (requires a live xterm buffer) is headless-exempt.
  'layout-persistence': new Set([
    'scrollback_repainted_before_reattach',
    'missing_scrollback_does_not_block_restore',
  ]),
};

// --- helpers -----------------------------------------------------------------

function snake(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[''`"]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function walk(dir, filterRe, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'target' || name === '.git') continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, filterRe, acc);
    else if (filterRe.test(name)) acc.push(full);
  }
  return acc;
}

// --- 1. collect scenarios, grouped by capability ----------------------------

const specGlobs = [
  join(REPO_ROOT, 'openspec', 'changes'),
  join(REPO_ROOT, 'openspec', 'specs'), // present once archived
];

const scenariosByCap = new Map(); // capability -> [{ title, snake }]

for (const base of specGlobs) {
  for (const file of walk(base, /\.md$/)) {
    // capability = the directory name immediately under .../specs/
    const m = file.replace(/\\/g, '/').match(/\/specs\/([^/]+)\//);
    if (!m) continue;
    const capability = m[1];
    const text = readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const sm = line.match(/^####\s+Scenario:\s*(.+?)\s*$/);
      if (!sm) continue;
      const title = sm[1];
      const arr = scenariosByCap.get(capability) ?? [];
      arr.push({ title, snake: snake(title) });
      scenariosByCap.set(capability, arr);
    }
  }
}

// --- 2. collect test names ---------------------------------------------------

const rustTestNames = new Set();
for (const file of walk(join(REPO_ROOT, 'src-tauri'), /\.rs$/)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\bfn\s+([a-z0-9_]+)\s*\(/g)) {
    rustTestNames.add(m[1]);
  }
}

const vitestTitles = new Set();
for (const file of walk(join(REPO_ROOT, 'src'), /\.(test|spec)\.(ts|js|mjs)$/)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\b(?:it|test|describe)\s*\(\s*(['"`])([^'"`]+)\1/g)) {
    vitestTitles.add(snake(m[2]));
  }
}

function isCovered(snakeName) {
  return rustTestNames.has(snakeName) || vitestTitles.has(snakeName);
}

// --- 3. report ---------------------------------------------------------------

const caps = [...scenariosByCap.keys()].sort();
const enforced = caps.filter((c) => ENFORCED_CAPABILITIES.has(c));
const pending = caps.filter((c) => !ENFORCED_CAPABILITIES.has(c));

let hardFailures = 0;
const lines = [];
lines.push('Scenario coverage gate (tools/check-scenario-coverage.mjs)');
lines.push(`  scanned: ${rustTestNames.size} Rust fn names, ${vitestTitles.size} Vitest titles`);
lines.push('');

for (const cap of enforced) {
  lines.push(`ENFORCED capability: ${cap}`);
  const scenarios = scenariosByCap.get(cap);
  const manual = MANUAL_SCENARIOS[cap] ?? new Set();
  let covered = 0;
  let manualCount = 0;
  const missing = [];
  for (const s of scenarios) {
    if (isCovered(s.snake)) {
      covered++;
      lines.push(`  [PASS]   ${s.title}  (${s.snake})`);
    } else if (manual.has(s.snake)) {
      manualCount++;
      lines.push(`  [MANUAL] ${s.title}  -> needs live in-app confirmation`);
    } else {
      missing.push(s);
      lines.push(`  [FAIL]   ${s.title}  (${s.snake})  -> no matching test`);
    }
  }
  lines.push(
    `  => ${covered} covered, ${manualCount} manual (headless-exempt), ${missing.length} missing of ${scenarios.length} total`
  );
  lines.push('');
  hardFailures += missing.length;
}

if (pending.length) {
  lines.push('KNOWN-PENDING capabilities (future milestones — not enforced now):');
  for (const cap of pending) {
    const n = scenariosByCap.get(cap).length;
    lines.push(`  - ${cap}: ${n} scenarios (pending)`);
  }
  lines.push('');
}

if (hardFailures > 0) {
  lines.push(`RESULT: FAIL — ${hardFailures} enforced scenario(s) have no matching test.`);
  console.log(lines.join('\n'));
  process.exit(1);
} else {
  lines.push('RESULT: PASS — every enforced, testable scenario has a matching test.');
  console.log(lines.join('\n'));
  process.exit(0);
}
