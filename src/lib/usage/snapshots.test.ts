import { describe, expect, it } from 'vitest';
import { apply, SnapshotsStore, type Snapshot, type SnapshotMap } from './snapshots.svelte';

// Tests for the PURE snapshot reducer that backs the runes `snapshots` store.
// The `it(...)` titles are the EXACT `#### Scenario:` names from the
// usage-dashboard spec (Requirement: Snapshot Directory Watching and Push) so
// the coverage gate can match the snapshot-watching scenarios to this unit test.
// The notify->event integration itself is exercised by the Rust watcher test
// and is MANUAL at the live-app level.

function snap(paneId: string, over: Partial<Snapshot> = {}): Snapshot {
  return {
    pane_id: paneId,
    session_id: null,
    model: null,
    model_id: null,
    effort: null,
    task: null,
    context_pct: null,
    rate_limits: null,
    cost: null,
    git: null,
    ts: 1,
    ...over
  };
}

describe('snapshots reducer', () => {
  // The push path: a snapshot emitted by the watcher updates the map keyed on
  // its pane_id, leaving every other pane's last value intact.
  it('Change pushed to frontend', () => {
    const a = snap('pane-a', { model: 'Opus', context_pct: 40, ts: 100 });
    const b = snap('pane-b', { model: 'Sonnet', context_pct: 12, ts: 101 });

    // Applying into an empty map keys the entry on pane_id.
    const m1 = apply({}, a);
    expect(m1).toEqual({ 'pane-a': a });

    // A second pane is added alongside, not replacing the first.
    const m2 = apply(m1, b);
    expect(Object.keys(m2).sort()).toEqual(['pane-a', 'pane-b']);
    expect(m2['pane-a']).toBe(a);
    expect(m2['pane-b']).toBe(b);

    // A newer snapshot for an existing pane REPLACES that pane's entry (keyed on
    // pane_id, not session_id — a resume/fork updates in place, never duplicates).
    const aNewer = snap('pane-a', { model: 'Opus', context_pct: 55, ts: 200, session_id: 'forked' });
    const m3 = apply(m2, aNewer);
    expect(m3['pane-a']).toBe(aNewer);
    expect(m3['pane-a'].context_pct).toBe(55);
    expect(Object.keys(m3).sort()).toEqual(['pane-a', 'pane-b']);

    // Pure: none of the prior maps were mutated.
    expect(m1).toEqual({ 'pane-a': a });
    expect(m2['pane-a']).toBe(a);
  });

  // The skip path: a null / malformed / unkeyed payload is ignored — the SAME
  // map reference is returned, so the dashboard keeps the last valid state for
  // every pane and nothing throws.
  it('Malformed snapshot skipped', () => {
    const base: SnapshotMap = { 'pane-a': snap('pane-a', { ts: 100 }) };

    const malformed: unknown[] = [
      null,
      undefined,
      {}, // no pane_id
      { pane_id: '' }, // empty pane_id
      { pane_id: 42 }, // wrong type
      'not-an-object',
      42,
      [],
      { session_id: 's', ts: 5 } // valid-ish but missing the required pane_id
    ];

    for (const bad of malformed) {
      const next = apply(base, bad);
      // Same reference back: no spurious update, last valid state preserved.
      expect(next).toBe(base);
    }
    expect(base).toEqual({ 'pane-a': snap('pane-a', { ts: 100 }) });
  });

  // Ghost-snapshot pruning: retain() keeps only the snapshots whose pane_id is in
  // the live set and drops the rest, so a closed pane's stale snapshot can't show
  // as a ghost agent, inflate cost totals, or linger in the foreign exclude-set.
  it('retain prunes snapshots for panes that no longer exist', () => {
    const store = new SnapshotsStore();
    store.ingest(snap('pane-a', { ts: 1 }));
    store.ingest(snap('pane-b', { ts: 2 }));
    store.ingest(snap('pane-c', { ts: 3 }));
    expect(Object.keys(store.byPane).sort()).toEqual(['pane-a', 'pane-b', 'pane-c']);

    // Only pane-a and pane-c are still live; pane-b closed -> its snapshot is dropped.
    store.retain(new Set(['pane-a', 'pane-c']));
    expect(Object.keys(store.byPane).sort()).toEqual(['pane-a', 'pane-c']);
    expect(store.get('pane-b')).toBeUndefined();
    // The surviving entries are untouched.
    expect(store.get('pane-a')?.ts).toBe(1);
    expect(store.get('pane-c')?.ts).toBe(3);

    // Idempotent + no spurious change when every key is already live: the same map
    // reference is kept (no reactive churn).
    const before = store.byPane;
    store.retain(new Set(['pane-a', 'pane-c']));
    expect(store.byPane).toBe(before);

    // A live set that covers nothing drops everything.
    store.retain(new Set());
    expect(store.byPane).toEqual({});
  });
});
