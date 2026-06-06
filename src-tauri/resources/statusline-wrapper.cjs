#!/usr/bin/env node
'use strict';

// agent-desktop statusline wrapper (Milestone 3 / D3).
//
// Installed to <app-support>/bin/statusline-wrapper.js and wired into a Claude
// session via `claude --settings '{"statusLine":{"type":"command",
// "command":"<abs>/statusline-wrapper.js"}}'`. Claude invokes it on every render
// with the statusline JSON on stdin and the per-pane env it was spawned with:
//   AGENT_DESKTOP_PANE         = the stable pane uuid (snapshot filename key)
//   AGENT_DESKTOP_SNAPSHOT_DIR = the app-support snapshots dir
//
// On each invocation it does TWO things, in this order, and NEVER throws:
//   (a) DELEGATE to the user's real ~/.claude/hooks/statusline.js with the SAME
//       stdin and pass its stdout through verbatim, so the in-pane status bar is
//       byte-for-byte unchanged. (Missing/failing user statusline degrades to an
//       empty bar, never a crash.)
//   (b) Derive a per-pane snapshot from the same stdin and write it ATOMICALLY
//       (sibling .tmp then rename) to <SNAPSHOT_DIR>/<PANE>.json.
//
// The snapshot write is a best-effort side effect: any failure there must never
// prevent (a) from passing the delegated bar through. We therefore run the
// snapshot in its own try/catch and the delegation in its own.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

// ---------------------------------------------------------------------------
// Small, never-throwing helpers.
// ---------------------------------------------------------------------------

/** Home dir, defensively (env first, then os.homedir()). */
function homeDir() {
  return process.env.HOME || os.homedir() || '';
}

/** Path to the user's real statusline hook we delegate to. */
function userStatuslinePath() {
  return path.join(homeDir(), '.claude', 'hooks', 'statusline.js');
}

/**
 * Read ALL of stdin once, synchronously, as a UTF-8 string. Returns '' on any
 * error (closed fd, no data). We read fd 0 in chunks so we get the whole
 * payload regardless of pipe buffering.
 */
function readAllStdin() {
  try {
    const chunks = [];
    const buf = Buffer.alloc(65536);
    let bytes;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        bytes = fs.readSync(0, buf, 0, buf.length, null);
      } catch (e) {
        // EAGAIN can happen on a non-blocking stdin; treat anything else as EOF.
        if (e && e.code === 'EAGAIN') continue;
        break;
      }
      if (bytes === 0) break;
      chunks.push(Buffer.from(buf.subarray(0, bytes)));
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch {
    return '';
  }
}

/** Parse JSON, returning null instead of throwing. */
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** A finite number, or null. */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** A non-empty trimmed string, or null. */
function str(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

/** Guard a session_id so it can never escape the tasks dir via path separators. */
function safeSessionId(id) {
  const s = str(id);
  if (!s) return null;
  if (s.includes('/') || s.includes('\\') || s.includes('..')) return null;
  return s;
}

// ---------------------------------------------------------------------------
// (a) Delegation to the user's real statusline — in-pane bar unchanged.
// ---------------------------------------------------------------------------

/**
 * Run ~/.claude/hooks/statusline.js with the identical stdin and write its
 * stdout to our own stdout verbatim. If the hook is absent or errors, emit
 * nothing (an empty bar) — never crash the session.
 */
function delegate(stdinText) {
  try {
    const hook = userStatuslinePath();
    if (!fs.existsSync(hook)) return; // missing user statusline -> empty bar
    const res = spawnSync(process.execPath, [hook], {
      input: stdinText,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 5000,
      encoding: 'buffer',
    });
    if (res && res.stdout && res.stdout.length) {
      process.stdout.write(res.stdout);
    }
  } catch {
    // Delegation failure must not break the session; emit nothing.
  }
}

// ---------------------------------------------------------------------------
// (b) Snapshot derivation from the statusline stdin.
// ---------------------------------------------------------------------------

/**
 * Context percentage 0..100, or null. Per the VERIFIED schema there is NO
 * `total_tokens` field; we use context_window.used_percentage, else derive from
 * remaining_percentage (100 - remaining). We deliberately do NOT compute from
 * current_usage/context_window_size token ratios — used/remaining percentage are
 * the source of truth.
 */
function contextPct(data) {
  const cw = data && data.context_window;
  if (!cw || typeof cw !== 'object') return null;
  const used = num(cw.used_percentage);
  if (used !== null) return used;
  const remaining = num(cw.remaining_percentage);
  if (remaining !== null) return 100 - remaining;
  return null;
}

/**
 * The current task: newest in_progress entry's activeForm from
 * ~/.claude/tasks/<session_id>/*.json. Falls back to subject/content if
 * activeForm is absent (schema drift). Returns null if no in_progress task or on
 * any IO/parse error. Fully guarded; never throws.
 */
function detectTask(sessionId) {
  try {
    const sid = safeSessionId(sessionId);
    if (!sid) return null;
    const dir = path.join(homeDir(), '.claude', 'tasks', sid);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return null;
    }
    let best = null; // { mtimeMs, task }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const full = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      let entry;
      try {
        entry = JSON.parse(fs.readFileSync(full, 'utf8'));
      } catch {
        continue;
      }
      if (!entry || entry.status !== 'in_progress') continue;
      const label = str(entry.activeForm) || str(entry.subject) || str(entry.content);
      if (!label) continue;
      if (!best || stat.mtimeMs > best.mtimeMs) {
        best = { mtimeMs: stat.mtimeMs, task: label };
      }
    }
    return best ? best.task : null;
  } catch {
    return null;
  }
}

/**
 * Git branch + dirty flag + ahead/behind counts for the workspace dir, by
 * shelling out to git with short timeouts. Returns
 * { branch, dirty, ahead, behind } — always an object (never null) so the
 * snapshot has a stable shape; individual fields are null when git can't answer.
 * `behind` is vs origin/main; `ahead` is vs the upstream branch. Fully guarded.
 */
function gitStatus(workspaceDir) {
  const out = { branch: null, dirty: null, ahead: null, behind: null };
  try {
    const dir = str(workspaceDir);
    if (!dir) return out;
    const runGit = (args) => {
      const res = spawnSync('git', ['-C', dir, ...args], {
        timeout: 1500,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      if (!res || res.status !== 0 || res.error) return null;
      return typeof res.stdout === 'string' ? res.stdout.trim() : null;
    };
    const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch !== null) out.branch = branch.length ? branch : null;
    // `--porcelain` prints one line per change; empty stdout => clean tree.
    const porcelain = runGit(['status', '--porcelain']);
    if (porcelain !== null) out.dirty = porcelain.length > 0;
    // Commits BEHIND origin/main (matches the user's Claude statusline). Null
    // when origin/main is unavailable (no remote / not fetched).
    const behind = runGit(['rev-list', 'HEAD..origin/main', '--count', '--no-merges']);
    if (behind !== null) {
      const n = parseInt(behind, 10);
      if (Number.isFinite(n)) out.behind = n;
    }
    // Commits AHEAD of the upstream tracking branch (not yet pushed). Null when
    // there is no upstream set.
    const ahead = runGit(['rev-list', '@{upstream}..HEAD', '--count']);
    if (ahead !== null) {
      const n = parseInt(ahead, 10);
      if (Number.isFinite(n)) out.ahead = n;
    }
  } catch {
    // leave nulls
  }
  return out;
}

/**
 * Build the snapshot object from parsed statusline stdin. Every field is
 * defensively derived; absent inputs yield null (never throws).
 */
function buildSnapshot(paneId, data) {
  const sessionId = data ? safeSessionId(data.session_id) : null;
  const model = data && data.model ? str(data.model.display_name) : null;
  const rawCost = data && data.cost ? num(data.cost.total_cost_usd) : null;

  // rate_limits is OFTEN ABSENT (non Pro/Max, or before first API response) ->
  // emit the object verbatim when present, else null.
  let rateLimits = null;
  if (data && data.rate_limits && typeof data.rate_limits === 'object') {
    rateLimits = data.rate_limits;
  }

  const workspaceDir = data && data.workspace ? str(data.workspace.current_dir) : null;

  return {
    pane_id: paneId,
    session_id: sessionId,
    model,
    task: detectTask(sessionId),
    context_pct: contextPct(data),
    rate_limits: rateLimits,
    cost: rawCost,
    git: gitStatus(workspaceDir),
    ts: Math.floor(Date.now() / 1000),
  };
}

/**
 * Atomically write `<snapshotDir>/<paneId>.json`: write a sibling .tmp in the
 * SAME dir, then rename it into place, so a reader (the watcher) never observes
 * a partial file. Fully guarded; never throws.
 */
function writeSnapshotAtomic(snapshotDir, paneId, snapshot) {
  try {
    const dir = str(snapshotDir);
    const pane = safeSessionId(paneId); // pane id must also not contain separators
    if (!dir || !pane) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // if the dir can't be created we simply skip; delegation still ran.
    }
    const target = path.join(dir, `${pane}.json`);
    // Unique temp sibling so concurrent renders don't clobber each other's tmp.
    const tmp = path.join(dir, `.${pane}.${process.pid}.${Date.now()}.tmp`);
    const json = JSON.stringify(snapshot);
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, target);
  } catch {
    // Snapshot is best-effort; failure here must never affect the in-pane bar.
  }
}

// ---------------------------------------------------------------------------
// main — never throws.
// ---------------------------------------------------------------------------

function main() {
  const stdinText = readAllStdin();

  // (a) Delegate FIRST so the in-pane bar renders even if the snapshot half
  // would fail. Guarded internally.
  delegate(stdinText);

  // (b) Best-effort snapshot. Entirely independent of (a).
  try {
    const paneId = str(process.env.AGENT_DESKTOP_PANE);
    const snapshotDir = str(process.env.AGENT_DESKTOP_SNAPSHOT_DIR);
    if (paneId && snapshotDir) {
      const data = safeParse(stdinText); // may be null on unparseable stdin
      const snapshot = buildSnapshot(paneId, data);
      writeSnapshotAtomic(snapshotDir, paneId, snapshot);
    }
  } catch {
    // never throw
  }
}

main();
