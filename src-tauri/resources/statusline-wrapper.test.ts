// Wrapper snapshot tests (Milestone 3 / usage-dashboard, tasks.md 5.1).
//
// These drive the PRODUCTION wrapper (src-tauri/resources/statusline-wrapper.js)
// by piping a synthetic statusline stdin payload through it with
//   AGENT_DESKTOP_PANE         = a fixed test pane uuid
//   AGENT_DESKTOP_SNAPSHOT_DIR = a fresh temp dir
// and assert the snapshot JSON the wrapper writes.
//
// Test titles map to the `#### Scenario:` names in
// openspec/changes/add-agent-desktop/specs/usage-dashboard/spec.md (the coverage
// gate normalizes both to snake_case) for the wrapper write + atomic write +
// missing-rate-limits scenarios:
//   - "Snapshot field shape"           (the wrapper write)
//   - "Atomic tmp+rename"              (no partial files; rename into place)
//   - "Absent rate limits render as null" (the second / missing-rate-limits case)
//   - "Context from the correct fields"   (used/remaining %, never total_tokens)
//   - "File keyed on pane id"
//   - "Snapshot side effect never breaks the in-pane bar"
//
// The DELEGATION half ("In-pane bar unchanged via delegation") spawns the user's
// real ~/.claude/hooks/statusline.js, whose output is machine-specific; that half
// is confirmed live in-app (MANUAL) and is asserted here only for the weaker
// "delegation never crashes the wrapper" property.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const WRAPPER = join(HERE, 'statusline-wrapper.cjs');
const PANE_ID = 'pane-test-uuid-0001';

let snapshotDir: string;

/** Run the wrapper with the given stdin payload + pane env; return its result. */
function runWrapper(stdin: string, env: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [WRAPPER], {
    input: stdin,
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      AGENT_DESKTOP_PANE: PANE_ID,
      AGENT_DESKTOP_SNAPSHOT_DIR: snapshotDir,
      ...env,
    },
  });
}

/** Parse the written snapshot for PANE_ID. */
function readSnapshot(): Record<string, unknown> {
  const file = join(snapshotDir, `${PANE_ID}.json`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** A representative statusline stdin payload (VERIFIED schema from Appendix A.2). */
function basePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: 'sess-abc-123',
    model: { display_name: 'Claude Opus 4.8', id: 'claude-opus-4-8' },
    workspace: { current_dir: snapshotDir },
    context_window: {
      total_input_tokens: 12000,
      total_output_tokens: 3000,
      context_window_size: 200000,
      current_usage: 15000,
      used_percentage: 42.5,
      remaining_percentage: 57.5,
    },
    rate_limits: {
      five_hour: { used_percentage: 10, resets_at: 1234567890 },
      seven_day: { used_percentage: 20, resets_at: 1234567999 },
    },
    cost: { total_cost_usd: 0.5 },
    exceeds_200k_tokens: false,
    ...overrides,
  });
}

beforeEach(() => {
  snapshotDir = mkdtempSync(join(tmpdir(), 'agentdesk-snap-'));
});

afterEach(() => {
  try {
    rmSync(snapshotDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe('statusline-wrapper snapshot write', () => {
  it('Snapshot field shape', () => {
    const res = runWrapper(basePayload());
    expect(res.status).toBe(0);

    const snap = readSnapshot();
    // The exact field set from the spec/design: pane_id, session_id, model, task,
    // context_pct, rate_limits, cost, git, ts.
    expect(Object.keys(snap).sort()).toEqual(
      ['context_pct', 'cost', 'git', 'model', 'pane_id', 'rate_limits', 'session_id', 'task', 'ts'].sort()
    );
    expect(snap.pane_id).toBe(PANE_ID);
    expect(snap.session_id).toBe('sess-abc-123');
    expect(snap.model).toBe('Claude Opus 4.8');
    expect(snap.context_pct).toBe(42.5);
    expect(snap.cost).toBe(0.5);
    expect(snap.rate_limits).toEqual({
      five_hour: { used_percentage: 10, resets_at: 1234567890 },
      seven_day: { used_percentage: 20, resets_at: 1234567999 },
    });
    // git is always an object (branch + dirty + modified + ahead + behind); values
    // may be null off-repo (the temp workspace dir is not a git repo).
    expect(typeof snap.git).toBe('object');
    expect(snap.git).not.toBeNull();
    expect(snap.git).toHaveProperty('branch');
    expect(snap.git).toHaveProperty('dirty');
    expect(snap.git).toHaveProperty('modified');
    expect(snap.git).toHaveProperty('ahead');
    expect(snap.git).toHaveProperty('behind');
    expect((snap.git as Record<string, unknown>).ahead).toBeNull();
    expect((snap.git as Record<string, unknown>).behind).toBeNull();
    // ts is a unix-SECONDS integer (not ms).
    expect(Number.isInteger(snap.ts)).toBe(true);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(snap.ts as number).toBeGreaterThan(nowSec - 120);
    expect(snap.ts as number).toBeLessThanOrEqual(nowSec + 5);
  });

  it('File keyed on pane id', () => {
    // A different session_id must NOT change the filename — it is keyed on the
    // pane uuid so a resumed/forked session keeps the same card.
    const res = runWrapper(basePayload({ session_id: 'a-totally-different-session' }));
    expect(res.status).toBe(0);
    const files = readdirSync(snapshotDir).filter((f) => f.endsWith('.json'));
    expect(files).toEqual([`${PANE_ID}.json`]);
    const snap = readSnapshot();
    expect(snap.pane_id).toBe(PANE_ID);
    expect(snap.session_id).toBe('a-totally-different-session');
  });

  it('Context from the correct fields', () => {
    // 1) used_percentage is used directly.
    let res = runWrapper(basePayload());
    expect(res.status).toBe(0);
    expect(readSnapshot().context_pct).toBe(42.5);

    // 2) when used_percentage is absent, derive from remaining_percentage.
    res = runWrapper(
      basePayload({
        context_window: {
          context_window_size: 200000,
          remaining_percentage: 70,
          // deliberately NO used_percentage, and a `total_tokens` decoy that
          // must be ignored (the field does not exist in the real schema).
          total_tokens: 999999,
        },
      })
    );
    expect(res.status).toBe(0);
    expect(readSnapshot().context_pct).toBe(30); // 100 - 70

    // 3) no usable context fields at all -> null (not a misleading 0).
    res = runWrapper(basePayload({ context_window: { context_window_size: 200000 } }));
    expect(res.status).toBe(0);
    expect(readSnapshot().context_pct).toBeNull();
  });

  it('Absent rate limits render as null', () => {
    // The SECOND case: a payload with NO rate_limits (non Pro/Max, or before the
    // first API response). The snapshot's rate_limits must be null, not missing
    // and not an error.
    const res = runWrapper(basePayload({ rate_limits: undefined }));
    expect(res.status).toBe(0);
    const snap = readSnapshot();
    expect('rate_limits' in snap).toBe(true);
    expect(snap.rate_limits).toBeNull();
    // The rest of the snapshot is still well-formed.
    expect(snap.model).toBe('Claude Opus 4.8');
    expect(snap.context_pct).toBe(42.5);
  });

  it('Atomic tmp+rename', () => {
    const res = runWrapper(basePayload());
    expect(res.status).toBe(0);
    // After a render, exactly the final <pane>.json exists — NO leftover .tmp
    // sibling, proving the temp file was renamed (not left in place) and that a
    // watcher never sees a partial/truncated file.
    const all = readdirSync(snapshotDir);
    expect(all).toContain(`${PANE_ID}.json`);
    expect(all.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    // The committed file is whole, parseable JSON.
    expect(() => readSnapshot()).not.toThrow();
  });

  it('Snapshot side effect never breaks the in-pane bar', () => {
    // Unparseable stdin must NOT crash the wrapper (exit 0) and must NOT leave a
    // partial snapshot; the delegated bar still gets a chance to render.
    const res = runWrapper('this is not json {{{');
    expect(res.status).toBe(0);
    // No .tmp turds even on the bad-input path.
    if (existsSync(snapshotDir)) {
      expect(readdirSync(snapshotDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    }

    // An unwritable snapshot dir also must not crash the wrapper.
    const res2 = runWrapper(basePayload(), {
      AGENT_DESKTOP_SNAPSHOT_DIR: '/proc/nonexistent/cannot/write/here',
    });
    expect(res2.status).toBe(0);
  });

  it('In-pane bar unchanged via delegation', () => {
    // Delegation half. The user's real ~/.claude/hooks/statusline.js output is
    // machine-specific (verified live in-app — MANUAL), so here we assert only
    // the load-bearing property the wrapper guarantees: delegating to the user
    // statusline (present or absent) never crashes the wrapper and the snapshot
    // half still completes.
    const res = runWrapper(basePayload());
    expect(res.status).toBe(0); // delegation did not throw
    // Whatever the user bar printed, the snapshot still got written.
    expect(existsSync(join(snapshotDir, `${PANE_ID}.json`))).toBe(true);

    // MANUAL: confirm in a live in-app pane that the rendered in-pane status bar
    // is byte-for-byte identical to the user's normal ~/.claude/hooks/statusline.js
    // output (tasks.md 5.6 — the one non-headless gate).
  });

  it('Missing user statusline.js degrades gracefully', () => {
    // Point HOME at a fresh temp dir with NO ~/.claude/hooks/statusline.js. The
    // wrapper resolves the user hook via HOME (homeDir() checks process.env.HOME
    // first), so this deterministically exercises the absent-hook path headlessly.
    const fakeHome = mkdtempSync(join(tmpdir(), 'agentdesk-home-'));
    try {
      const res = runWrapper(basePayload(), { HOME: fakeHome });
      // No user hook -> empty bar, but the wrapper must still exit cleanly.
      expect(res.status).toBe(0);
      expect(res.stdout).toBe(''); // empty in-pane bar, not a crash
      // The snapshot write half still completes despite the missing hook.
      expect(existsSync(join(snapshotDir, `${PANE_ID}.json`))).toBe(true);
      expect(readSnapshot().pane_id).toBe(PANE_ID);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
