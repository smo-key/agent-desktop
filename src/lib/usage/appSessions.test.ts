import { describe, expect, it } from 'vitest';
import { appSessionIds } from './appSessions';
import type { Snapshot, SnapshotMap } from './snapshots.svelte';

// Tests for the PURE helper that extracts the app-launched session-id exclude-set
// from the per-pane snapshot map (Milestone 4, design D7). The foreign-sessions
// subsystem excludes exactly these ids so the app never shows one of its own panes
// as "external".

function snap(paneId: string, sessionId: string | null): Snapshot {
  return {
    pane_id: paneId,
    session_id: sessionId,
    model: null,
    model_id: null,
    effort: null,
    task: null,
    context_pct: null,
    rate_limits: null,
    cost: null,
    git: null,
    ts: 1
  };
}

describe('appSessionIds', () => {
  it('collects sorted, de-duped, non-empty session ids', () => {
    const map: SnapshotMap = {
      'pane-c': snap('pane-c', 'sess-b'),
      'pane-a': snap('pane-a', 'sess-a'),
      'pane-b': snap('pane-b', 'sess-a'), // duplicate session id (e.g. a fork)
      'pane-d': snap('pane-d', null), // no session yet -> skipped
      'pane-e': snap('pane-e', '') // empty -> skipped
    };
    expect(appSessionIds(map)).toEqual(['sess-a', 'sess-b']);
  });

  it('is empty for an empty map', () => {
    expect(appSessionIds({})).toEqual([]);
  });
});
