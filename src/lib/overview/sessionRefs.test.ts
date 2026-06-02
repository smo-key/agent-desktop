import { describe, expect, it } from 'vitest';
import { appSessionRefs } from './sessionRefs';
import type { Snapshot, SnapshotMap } from '../usage/snapshots.svelte';

// Tests for the PURE app-pane session-ref helper (Stage 3 of agent-overview). It
// joins each app pane's snapshot `session_id` with its registry cwd so the
// subagents store can ask the Rust `subagents_for` command for the right project
// dirs. Not a spec scenario itself — supports the live Surface Subagents wiring.

function snap(paneId: string, over: Partial<Snapshot> = {}): Snapshot {
  return {
    pane_id: paneId,
    session_id: null,
    model: null,
    task: null,
    context_pct: null,
    rate_limits: null,
    cost: null,
    git: null,
    ts: 1,
    ...over
  };
}

function mapOf(...snaps: Snapshot[]): SnapshotMap {
  const m: SnapshotMap = {};
  for (const s of snaps) m[s.pane_id] = s;
  return m;
}

describe('sessionRefs — app pane session refs', () => {
  it('joins each session id with its pane cwd, sorted and de-duped', () => {
    const map = mapOf(
      snap('pane-b', { session_id: 'sess-2' }),
      snap('pane-a', { session_id: 'sess-1' }),
      snap('pane-c', { session_id: null }) // no session yet -> skipped
    );
    const cwds: Record<string, string | null> = {
      'pane-a': '/Users/me/proj-a',
      'pane-b': '/Users/me/proj-b'
    };
    const refs = appSessionRefs(map, (paneId) => cwds[paneId] ?? null);
    expect(refs).toEqual([
      { sessionId: 'sess-1', cwd: '/Users/me/proj-a' },
      { sessionId: 'sess-2', cwd: '/Users/me/proj-b' }
    ]);
  });

  it('two panes sharing a session id collapse to one ref (first cwd wins)', () => {
    const map = mapOf(
      snap('pane-z', { session_id: 'sess-x' }),
      snap('pane-a', { session_id: 'sess-x' })
    );
    const cwds: Record<string, string | null> = {
      'pane-a': '/Users/me/first',
      'pane-z': '/Users/me/second'
    };
    const refs = appSessionRefs(map, (paneId) => cwds[paneId] ?? null);
    // Sorted-pane-id order means pane-a is encountered first.
    expect(refs).toEqual([{ sessionId: 'sess-x', cwd: '/Users/me/first' }]);
  });

  it('an empty map yields no refs', () => {
    expect(appSessionRefs({}, () => null)).toEqual([]);
  });
});
