import { describe, expect, it } from 'vitest';
import {
  buildRoster,
  deriveStatus,
  laneOf,
  groupByLane,
  LANE_ORDER,
  WORKING_WINDOW_MS,
  type AgentRow,
  type PaneRuntime,
  type RosterWorkspace,
  type RuntimeMap
} from './roster';
import type { Snapshot, SnapshotMap } from '../usage/snapshots.svelte';
import type { EventActivity } from './events';

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

/** A runtime entry for a pane (PTY activity + process state). */
function rt(paneId: string, over: Partial<PaneRuntime> = {}): [string, PaneRuntime] {
  return [paneId, { lastOutputAt: null, exited: false, exitCode: null, ...over }];
}

function runtimeOf(...entries: [string, PaneRuntime][]): RuntimeMap {
  const m: RuntimeMap = {};
  for (const [id, r] of entries) m[id] = r;
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
    const now = 1_000_000; // epoch ms
    const map = mapOf(
      snap('pane-a', {
        model: 'claude-opus',
        task: 'Refactoring the parser',
        context_pct: 42,
        cost: 1.25
      }),
      snap('pane-b', {
        model: 'claude-sonnet',
        task: 'Writing tests',
        context_pct: 13,
        cost: 0.4
      })
    );
    // pane-a is streaming output right now (working); pane-b last spoke a while
    // ago and is waiting on the user.
    const runtime = runtimeOf(
      rt('pane-a', { lastOutputAt: now - 200 }),
      rt('pane-b', { lastOutputAt: now - WORKING_WINDOW_MS - 5_000 })
    );
    const workspaces = [
      ws('ws-1', 'Parser', [{ paneId: 'pane-a', cwd: '/home/u/parser' }]),
      ws('ws-2', 'Tests', [{ paneId: 'pane-b', cwd: '/home/u/tests' }])
    ];

    const rows = buildRoster(map, workspaces, runtime, now);

    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.paneId === 'pane-a')!;
    expect(a.workspaceId).toBe('ws-1');
    expect(a.name).toBe('Parser');
    expect(a.cwd).toBe('/home/u/parser');
    expect(a.model).toBe('claude-opus');
    expect(a.task).toBe('Refactoring the parser');
    expect(a.contextPct).toBe(42);
    expect(a.cost).toBe(1.25);
    expect(a.status).toBe('working');

    const b = rows.find((r) => r.paneId === 'pane-b')!;
    expect(b.model).toBe('claude-sonnet');
    expect(b.task).toBe('Writing tests');
    expect(b.contextPct).toBe(13);
    expect(b.cost).toBe(0.4);
    expect(b.status).toBe('waiting');
  });

  // Only panes flagged as app (claude) sessions are agents; a plain shell pane in
  // the same workspace is not rostered. A pane with no runtime yet still rosters
  // (status derived from the missing activity), so the roster never silently drops
  // a freshly-launched agent — but a non-app pane never appears at all.
  it('Only app panes become agent rows', () => {
    const now = 1_000_000;
    const map = mapOf(snap('pane-app', { task: 'Building' }));
    const workspaces = [
      ws('ws-1', 'Mixed', [
        { paneId: 'pane-app', cwd: '/x', isApp: true },
        { paneId: 'pane-shell', cwd: '/x', isApp: false }
      ])
    ];

    const rows = buildRoster(map, workspaces, {}, now);

    expect(rows.map((r) => r.paneId)).toEqual(['pane-app']);
  });

  // Transcript-derived activity (summary + pending question), keyed on the PANE id,
  // is merged onto the agent's row so the overview can show its last message and any
  // pending question.
  it('Agent surfaces its transcript activity', () => {
    const now = 1_000_000;
    const map = mapOf(snap('pane-a'));
    const workspaces = [ws('ws-1', 'P', [{ paneId: 'pane-a', cwd: '/x' }])];
    const activity = {
      'pane-a': { summary: 'Looking at the parser', question: 'Which database?' }
    };

    const rows = buildRoster(map, workspaces, {}, now, activity);
    expect(rows[0].summary).toBe('Looking at the parser');
    expect(rows[0].question).toBe('Which database?');

    // A pane with no matching activity entry carries nulls.
    const noAct = buildRoster(map, workspaces, {}, now, {});
    expect(noAct[0].summary).toBeNull();
    expect(noAct[0].question).toBeNull();
  });

  // The agent's project binding (registry projectId) is carried onto its row so
  // the overview can render the project avatar + filter by project.
  it('Agent carries its project identity', () => {
    const now = 1_000_000;
    const map = mapOf(snap('pane-a'));
    const workspaces: RosterWorkspace[] = [
      {
        id: 'ws-1',
        name: 'Payments',
        panes: [{ paneId: 'pane-a', cwd: '/x', isApp: true, projectId: 'proj-pay' }]
      }
    ];

    const rows = buildRoster(map, workspaces, {}, now);

    expect(rows[0].projectId).toBe('proj-pay');
    // A pane with no project binding rosters with a null projectId (unassigned).
    const noProj = buildRoster(
      mapOf(snap('pane-b')),
      [ws('ws-2', 'X', [{ paneId: 'pane-b', cwd: '/y' }])],
      {},
      now
    );
    expect(noProj[0].projectId).toBeNull();
  });

  // Name falls back to a short cwd basename when the workspace name is empty.
  it('Name falls back to short cwd', () => {
    const now = 1_000_000;
    const map = mapOf(snap('pane-a'));
    const workspaces = [
      ws('ws-1', '', [{ paneId: 'pane-a', cwd: '/home/u/projects/agent-desktop' }])
    ];

    const rows = buildRoster(map, workspaces, {}, now);

    expect(rows[0].name).toBe('agent-desktop');
  });
});

describe('roster — Agent status heuristic', () => {
  it('Agent status reflects working, waiting, finished, and errored', () => {
    const now = 1_000_000; // epoch ms

    // Alive + recent PTY output (claude is streaming) => working.
    expect(deriveStatus({ lastOutputAt: now - 100, exited: false, exitCode: null }, now)).toBe(
      'working'
    );
    // Output exactly at the working window is still working (<= window).
    expect(
      deriveStatus({ lastOutputAt: now - WORKING_WINDOW_MS, exited: false, exitCode: null }, now)
    ).toBe('working');
    // Alive but no output recently (claude is quiet at the prompt) => waiting on
    // YOU — the visually prominent "needs input" state.
    expect(
      deriveStatus(
        { lastOutputAt: now - WORKING_WINDOW_MS - 1, exited: false, exitCode: null },
        now
      )
    ).toBe('waiting');
    // Alive + just spawned, no output yet => treated as working (starting up), so
    // a launching agent never flashes idle.
    expect(deriveStatus({ lastOutputAt: null, exited: false, exitCode: null }, now)).toBe(
      'working'
    );

    // Process exited cleanly (code 0 or unknown) => finished.
    expect(deriveStatus({ lastOutputAt: now - 50, exited: true, exitCode: 0 }, now)).toBe(
      'finished'
    );
    expect(deriveStatus({ lastOutputAt: now - 50, exited: true, exitCode: null }, now)).toBe(
      'finished'
    );
    // Process exited non-zero => errored, regardless of prior activity.
    expect(deriveStatus({ lastOutputAt: now - 50, exited: true, exitCode: 1 }, now)).toBe('error');
    expect(deriveStatus({ lastOutputAt: now - 50, exited: true, exitCode: 137 }, now)).toBe(
      'error'
    );

    // No runtime at all (pane not wired yet) => idle.
    expect(deriveStatus(undefined, now)).toBe('idle');
  });
});

describe('roster — control-room lanes', () => {
  // The Overview groups agents into three lanes, ordered top->bottom by how much
  // they need you: needs-attention (waiting/error), completed (finished), then
  // in-flight (working/idle, running on their own).
  it('maps each status to its lane', () => {
    expect(laneOf('waiting')).toBe('attn');
    expect(laneOf('error')).toBe('attn');
    expect(laneOf('finished')).toBe('done');
    expect(laneOf('working')).toBe('flight');
    expect(laneOf('idle')).toBe('flight');
  });

  it('orders lanes attention -> in-flight -> completed', () => {
    expect(LANE_ORDER).toEqual(['attn', 'flight', 'done']);
  });

  it('groups rows by lane, preserving roster order within each lane', () => {
    const row = (paneId: string, status: AgentRow['status']): AgentRow => ({
      paneId,
      workspaceId: 'ws',
      name: paneId,
      cwd: null,
      model: null,
      task: null,
      summary: null,
      question: null,
      questions: null,
      currentAction: null,
      contextPct: null,
      cost: null,
      status,
      projectId: null
    });
    const rows = [
      row('a', 'working'),
      row('b', 'waiting'),
      row('c', 'finished'),
      row('d', 'error'),
      row('e', 'idle')
    ];

    const grouped = groupByLane(rows);

    expect(grouped.attn.map((r) => r.paneId)).toEqual(['b', 'd']);
    expect(grouped.done.map((r) => r.paneId)).toEqual(['c']);
    expect(grouped.flight.map((r) => r.paneId)).toEqual(['a', 'e']);
  });
});

// Event-sourced status integration (activity-timeline). buildRoster prefers the
// event-derived status + currentAction + question, with PTY exit authoritative and
// the snapshot still the cost/model source. Titles match the spec scenarios.
describe('roster — event-sourced status', () => {
  const now = 1_000_000;
  const wsX = ws('w1', 'W', [{ paneId: 'pane-x', cwd: '/x' }]);
  const evAct = (over: Partial<EventActivity> = {}): Record<string, EventActivity> => ({
    'pane-x': { status: null, currentAction: null, question: null, questions: null, ...over }
  });

  it('Exit is authoritative', () => {
    // The process exited non-zero; even an event status of "working" must not win.
    const runtime = runtimeOf(rt('pane-x', { exited: true, exitCode: 1, lastOutputAt: now }));
    const [row] = buildRoster({}, [wsX], runtime, now, {}, WORKING_WINDOW_MS, evAct({ status: 'working' }));
    expect(row.status).toBe('error');
  });

  it('Status independent of snapshot', () => {
    // No snapshot at all, yet the event-sourced status + currentAction surface.
    const runtime = runtimeOf(rt('pane-x', { lastOutputAt: now - 999_999 })); // PTY would say "waiting"
    const [row] = buildRoster(
      {},
      [wsX],
      runtime,
      now,
      {},
      WORKING_WINDOW_MS,
      evAct({ status: 'working', currentAction: 'Bash:npm test' })
    );
    expect(row.status).toBe('working');
    expect(row.currentAction).toBe('Bash:npm test');
    expect(row.model).toBeNull();
  });

  it('Cost and model still read from snapshot', () => {
    const map = mapOf(snap('pane-x', { model: 'claude-opus', cost: 2.5 }));
    const [row] = buildRoster(map, [wsX], runtimeOf(), now, {}, WORKING_WINDOW_MS, evAct({ status: 'waiting' }));
    expect(row.model).toBe('claude-opus');
    expect(row.cost).toBe(2.5);
    expect(row.status).toBe('waiting');
  });
});
