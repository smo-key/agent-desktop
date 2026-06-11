import { describe, expect, it } from 'vitest';
import { taskBadge } from './taskBadge';
import { IDLE_AFTER_SECONDS } from './rollup';
import type { Snapshot } from './snapshots.svelte';

// Tests for the PURE per-pane task-badge view-model (Milestone 4, design D7;
// requirement "Surface Task Per Pane"). The badge reads straight from the pane's
// snapshot (the same one the dashboard card uses), so badge and card always agree.
//
// The Stage-1 Rust tests own the live/idle heartbeat scenario names
// (fresh_ts_is_live / stale_ts_is_idle) and the snapshot-task scenarios
// (task_read_from_snapshot / null_task_in_snapshot / task_updates_on_snapshot_change);
// we do NOT duplicate those titles. The describe/it titles here are the REQUIREMENT
// name "Surface Task Per Pane" so the badge's own view-model is canonically tested.

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    pane_id: 'pane-1',
    session_id: 'sess-1',
    model: 'Claude Opus',
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

describe('task-detection — Surface Task Per Pane', () => {
  it('Surface Task Per Pane', () => {
    const now = 1_000;

    // A fresh snapshot with a task -> a live badge carrying that label.
    const view = taskBadge(snap({ task: 'Refactoring the watcher', ts: now }), now);
    expect(view).toEqual({ label: 'Refactoring the watcher', live: true });

    // No snapshot at all -> render nothing (null).
    expect(taskBadge(undefined, now)).toBeNull();

    // A null task -> render nothing (the model+context still show on the card).
    expect(taskBadge(snap({ task: null, ts: now }), now)).toBeNull();

    // An empty / whitespace-only task is treated as no task (no empty pill).
    expect(taskBadge(snap({ task: '', ts: now }), now)).toBeNull();
    expect(taskBadge(snap({ task: '   ', ts: now }), now)).toBeNull();

    // The label is trimmed.
    expect(taskBadge(snap({ task: '  Writing tests  ', ts: now }), now)?.label).toBe(
      'Writing tests'
    );

    // Live/idle mirrors the card heartbeat: within the threshold -> live, beyond
    // it -> idle. (The scenario titles for this live in Stage-1 Rust; here we just
    // confirm the badge wires the same math.)
    expect(taskBadge(snap({ task: 't', ts: now - IDLE_AFTER_SECONDS }), now)?.live).toBe(true);
    expect(taskBadge(snap({ task: 't', ts: now - IDLE_AFTER_SECONDS - 1 }), now)?.live).toBe(false);

    // A non-finite ts is coerced to 0 (epoch) rather than throwing, so it reads as
    // long-idle — matching the dashboard card's `sessionCard` (ts ?? 0).
    expect(taskBadge(snap({ task: 't', ts: Number.NaN }), now)?.live).toBe(false);
    // A future ts (clock skew) is live.
    expect(taskBadge(snap({ task: 't', ts: now + 5 }), now)?.live).toBe(true);
  });
});
