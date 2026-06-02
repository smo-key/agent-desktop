import { describe, expect, it } from 'vitest';
import { buildRoster, statusOf, type RosterWorkspace } from './roster';
import { IDLE_AFTER_SECONDS } from '../usage/rollup';
import type { Snapshot, SnapshotMap } from '../usage/snapshots.svelte';

// Tests for the PURE roster view-model (Stage 1 of agent-overview). The `it(...)`
// titles are the EXACT `#### Scenario:` names from the agent-overview spec
// (Requirements: Agent Roster Overview) so the scenario-coverage gate maps each
// to this unit test. Visual rendering / click-to-navigate is MANUAL (live window).

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

/** One workspace with a single app (claude) pane. */
function ws(
  id: string,
  name: string,
  panes: { paneId: string; cwd: string | null; isApp?: boolean }[]
): RosterWorkspace {
  return {
    id,
    name,
    panes: panes.map((p) => ({
      paneId: p.paneId,
      cwd: p.cwd,
      isApp: p.isApp ?? true
    }))
  };
}

describe('roster — Agent Roster Overview', () => {
  it('Roster reflects running agents', () => {
    const now = 1000;
    const map = mapOf(
      snap('pane-a', {
        ts: now,
        model: 'claude-opus',
        task: 'Refactoring the parser',
        context_pct: 42,
        cost: 1.25
      }),
      snap('pane-b', {
        ts: now,
        model: 'claude-sonnet',
        task: 'Writing tests',
        context_pct: 13,
        cost: 0.4
      })
    );
    const workspaces = [
      ws('ws-1', 'Parser', [{ paneId: 'pane-a', cwd: '/home/u/parser' }]),
      ws('ws-2', 'Tests', [{ paneId: 'pane-b', cwd: '/home/u/tests' }])
    ];

    const rows = buildRoster(map, workspaces, now);

    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.paneId === 'pane-a')!;
    expect(a.workspaceId).toBe('ws-1');
    expect(a.name).toBe('Parser');
    expect(a.cwd).toBe('/home/u/parser');
    expect(a.model).toBe('claude-opus');
    expect(a.task).toBe('Refactoring the parser');
    expect(a.contextPct).toBe(42);
    expect(a.cost).toBe(1.25);
    expect(a.status).toBe('live');

    const b = rows.find((r) => r.paneId === 'pane-b')!;
    expect(b.model).toBe('claude-sonnet');
    expect(b.task).toBe('Writing tests');
    expect(b.contextPct).toBe(13);
    expect(b.cost).toBe(0.4);
  });

  // Only panes flagged as app (claude) sessions are agents; a plain shell pane in
  // the same workspace is not rostered. A pane with no snapshot yet still rosters
  // (status derived from the missing/stale heartbeat), so the roster never silently
  // drops a freshly-launched agent — but a non-app pane never appears at all.
  it('Only app panes become agent rows', () => {
    const now = 1000;
    const map = mapOf(snap('pane-app', { ts: now, task: 'Building' }));
    const workspaces = [
      ws('ws-1', 'Mixed', [
        { paneId: 'pane-app', cwd: '/x', isApp: true },
        { paneId: 'pane-shell', cwd: '/x', isApp: false }
      ])
    ];

    const rows = buildRoster(map, workspaces, now);

    expect(rows.map((r) => r.paneId)).toEqual(['pane-app']);
  });

  // Name falls back to a short cwd basename when the workspace name is empty.
  it('Name falls back to short cwd', () => {
    const now = 1000;
    const map = mapOf(snap('pane-a', { ts: now }));
    const workspaces = [
      ws('ws-1', '', [{ paneId: 'pane-a', cwd: '/home/u/projects/agent-desktop' }])
    ];

    const rows = buildRoster(map, workspaces, now);

    expect(rows[0].name).toBe('agent-desktop');
  });
});

describe('roster — Agent status heuristic', () => {
  const idle = IDLE_AFTER_SECONDS;

  it('Agent status derives from heartbeat and activity', () => {
    const now = 1000;

    // Fresh heartbeat + an in-progress task => live.
    const live = snap('p', { ts: now, task: 'Doing the thing' });
    expect(statusOf(live, now)).toBe('live');

    // Fresh heartbeat but NO in-progress task (waiting on / asking the user) =>
    // needs-attention.
    const waiting = snap('p', { ts: now, task: null });
    expect(statusOf(waiting, now)).toBe('needs-attention');
    const blankTask = snap('p', { ts: now, task: '   ' });
    expect(statusOf(blankTask, now)).toBe('needs-attention');

    // Stale heartbeat (older than the idle threshold) => idle, regardless of task.
    const stale = snap('p', { ts: now - idle - 1, task: 'Was doing something' });
    expect(statusOf(stale, now)).toBe('idle');
    const staleNoTask = snap('p', { ts: now - idle - 1, task: null });
    expect(statusOf(staleNoTask, now)).toBe('idle');

    // Exactly at the threshold is still fresh (<= idleAfter).
    const edge = snap('p', { ts: now - idle, task: 'Edge task' });
    expect(statusOf(edge, now)).toBe('live');

    // No snapshot at all (pane launched but no heartbeat yet) => idle.
    expect(statusOf(undefined, now)).toBe('idle');
  });
});
