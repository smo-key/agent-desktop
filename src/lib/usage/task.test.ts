import { describe, expect, it } from 'vitest';
import { apply, type Snapshot } from './snapshots.svelte';

// Frontend coverage for the task-detection scenarios that are SNAPSHOT-primary
// for app-launched sessions (design D7). The Rust side owns the live-tasks-dir
// derivation, the foreign-session watcher, and the live/idle heartbeat math (see
// src-tauri/src/task.rs, whose test fn names match the remaining scenarios). Here
// we assert the property the UI relies on: for app-launched sessions the per-pane
// `task` comes straight from the snapshot the dashboard already watches (carried
// through the pure reducer), with no independent watch of `~/.claude/tasks/`.
//
// The `it(...)` titles are the EXACT `#### Scenario:` names from the
// task-detection spec so the coverage gate matches them to these unit tests.

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

describe('task-detection — Snapshot Is The Primary Task Source For App-Launched Sessions', () => {
  // An app-launched pane's snapshot carries the derived `task` (the wrapper put
  // the newest in_progress activeForm there). The store keeps it verbatim, so the
  // card/badge read the task from the snapshot — no separate tasks-dir watch.
  it('Task read from snapshot', () => {
    const s = snap('pane-app', {
      session_id: 'sess-app',
      model: 'Claude Opus',
      task: 'Refactoring the watcher',
      context_pct: 42,
      ts: 100
    });
    const map = apply({}, s);
    expect(map['pane-app'].task).toBe('Refactoring the watcher');
    // The value is the snapshot's own field, untouched by the reducer.
    expect(map['pane-app']).toBe(s);
  });

  // A snapshot whose task is null renders no task label (and no error): the field
  // simply stays null through the reducer.
  it('Null task in snapshot', () => {
    const s = snap('pane-app', { session_id: 'sess-app', model: 'Claude Sonnet', task: null, ts: 7 });
    const map = apply({}, s);
    expect(map['pane-app'].task).toBeNull();
    expect(map['pane-app'].model).toBe('Claude Sonnet');
  });
});

describe('task-detection — Surface Task Per Pane', () => {
  // When the watched snapshot changes its `task` to a different activeForm, the
  // reducer replaces that pane's entry in place (keyed on pane_id), so a later
  // read sees the new task — the source of the per-pane badge + card update.
  it('Task updates on snapshot change', () => {
    const first = snap('pane-app', { session_id: 'sess-app', task: 'Writing tests', ts: 100 });
    const m1 = apply({}, first);
    expect(m1['pane-app'].task).toBe('Writing tests');

    const second = snap('pane-app', { session_id: 'sess-app', task: 'Reviewing the diff', ts: 200 });
    const m2 = apply(m1, second);
    expect(m2['pane-app'].task).toBe('Reviewing the diff');
    // In place: still a single pane entry, and the prior map is unmutated (pure).
    expect(Object.keys(m2)).toEqual(['pane-app']);
    expect(m1['pane-app'].task).toBe('Writing tests');
  });
});
